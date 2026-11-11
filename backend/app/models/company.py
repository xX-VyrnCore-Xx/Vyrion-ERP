import enum

from sqlalchemy import Boolean, CheckConstraint, String, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class LegalForm(enum.StrEnum):
    SOLE_PROPRIETORSHIP = "sole_proprietorship"  # ditta individuale / libero professionista
    SRL = "srl"
    SRLS = "srls"
    SPA = "spa"


class TaxRegime(enum.StrEnum):
    FORFETTARIO = "forfettario"
    ORDINARIO = "ordinario"


# FatturaPA <RegimeFiscale> codes.
FATTURAPA_REGIME_CODES: dict[TaxRegime, str] = {
    TaxRegime.ORDINARIO: "RF01",
    TaxRegime.FORFETTARIO: "RF19",
}


def is_valid_regime(legal_form: LegalForm, tax_regime: TaxRegime) -> bool:
    """The flat-rate regime is reserved to natural persons; companies are ordinary."""
    return tax_regime is not TaxRegime.FORFETTARIO or legal_form is LegalForm.SOLE_PROPRIETORSHIP


def _values(enum_cls: type[enum.StrEnum]) -> str:
    return ", ".join(f"'{member.value}'" for member in enum_cls)


class Company(UUIDPrimaryKeyMixin, TimestampMixin, VersionedMixin, Base):
    """The single company that owns this installation (VyrnCore Enterprises)."""

    __tablename__ = "companies"
    __table_args__ = (
        CheckConstraint("singleton", name="single_row"),
        CheckConstraint(f"legal_form IN ({_values(LegalForm)})", name="legal_form_valid"),
        CheckConstraint(f"tax_regime IN ({_values(TaxRegime)})", name="tax_regime_valid"),
        CheckConstraint(
            "tax_regime <> 'forfettario' OR legal_form = 'sole_proprietorship'",
            name="forfettario_only_natural_person",
        ),
    )

    # Always true and unique: the database itself refuses a second company row.
    singleton: Mapped[bool] = mapped_column(
        Boolean, nullable=False, unique=True, default=True, server_default=true()
    )
    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_form: Mapped[str] = mapped_column(String(32), nullable=False)
    tax_regime: Mapped[str] = mapped_column(String(32), nullable=False)
    vat_number: Mapped[str] = mapped_column(String(11), nullable=False)
    fiscal_code: Mapped[str] = mapped_column(String(16), nullable=False)
    street: Mapped[str] = mapped_column(String(200), nullable=False)
    postal_code: Mapped[str] = mapped_column(String(5), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    province: Mapped[str] = mapped_column(String(2), nullable=False)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="IT")

    @property
    def fatturapa_regime_code(self) -> str:
        return FATTURAPA_REGIME_CODES[TaxRegime(self.tax_regime)]
