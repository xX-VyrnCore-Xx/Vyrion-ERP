import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.core.italy import is_personal_fiscal_code_format, is_valid_partita_iva
from app.models.company import LegalForm, TaxRegime, is_valid_regime


def _upper(value: object) -> object:
    # Runs before the pattern check, which pydantic applies ahead of ``to_upper``.
    return value.strip().upper() if isinstance(value, str) else value


UpperCode = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z]{2}$")]
Text200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Text100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CompanyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    legal_name: Text200
    legal_form: LegalForm
    tax_regime: TaxRegime
    vat_number: Annotated[str, StringConstraints(strip_whitespace=True)]
    fiscal_code: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True)]
    street: Text200
    postal_code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{5}$")]
    city: Text100
    province: UpperCode
    country_code: UpperCode = "IT"

    @field_validator("vat_number")
    @classmethod
    def _check_vat_number(cls, value: str) -> str:
        if not is_valid_partita_iva(value):
            raise ValueError("invalid partita IVA")
        return value

    @model_validator(mode="after")
    def _check_consistency(self) -> Self:
        if not is_valid_regime(self.legal_form, self.tax_regime):
            raise ValueError("the forfettario regime is available only to sole proprietorships")
        if self.legal_form is LegalForm.SOLE_PROPRIETORSHIP:
            if not is_personal_fiscal_code_format(self.fiscal_code):
                raise ValueError("a sole proprietorship requires a 16-character codice fiscale")
        elif not is_valid_partita_iva(self.fiscal_code):
            raise ValueError("a company requires an 11-digit codice fiscale")
        return self


class CompanyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    legal_name: str
    legal_form: LegalForm
    tax_regime: TaxRegime
    fatturapa_regime_code: str
    vat_number: str
    fiscal_code: str
    street: str
    postal_code: str
    city: str
    province: str
    country_code: str
    created_at: datetime
    updated_at: datetime
