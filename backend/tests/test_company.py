from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, VersionConflictError
from app.core.ids import uuid7
from app.models import AuditLog, Company
from app.schemas.company import CompanyInput, CompanyRead
from app.services.audit import SYSTEM
from app.services.company import get_company, save_company

pytestmark = pytest.mark.integration

SRL: dict[str, Any] = {
    "legal_name": "VyrnCore Enterprises S.r.l.",
    "legal_form": "srl",
    "tax_regime": "ordinario",
    "vat_number": "12345678903",
    "fiscal_code": "12345678903",
    "street": "Via Roma 1",
    "postal_code": "00100",
    "city": "Roma",
    "province": "rm",
}
SOLE = {
    **SRL,
    "legal_name": "Mario Rossi",
    "legal_form": "sole_proprietorship",
    "tax_regime": "forfettario",
    "fiscal_code": "RSSMRA80A01H501U",
}


def test_input_normalises_and_validates() -> None:
    assert CompanyInput(**SRL).province == "RM"
    assert CompanyInput(**SOLE).tax_regime == "forfettario"


@pytest.mark.parametrize(
    "override",
    [
        {"tax_regime": "forfettario"},  # a company cannot be forfettario
        {"vat_number": "12345678901"},  # wrong check digit
        {"fiscal_code": "RSSMRA80A01H501U"},  # a company needs an 11-digit code
        {"postal_code": "0010"},
        {"province": "ROM"},
        {"legal_form": "sas"},
        {"unknown_field": "x"},
    ],
)
def test_invalid_input_rejected(override: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        CompanyInput(**{**SRL, **override})


def test_sole_proprietorship_requires_personal_fiscal_code() -> None:
    with pytest.raises(ValidationError):
        CompanyInput(**{**SOLE, "fiscal_code": "12345678903"})


async def test_create_then_update(db_session: AsyncSession) -> None:
    assert await get_company(db_session) is None

    company = await save_company(db_session, CompanyInput(**SRL), SYSTEM)
    assert company.version == 1
    read = CompanyRead.model_validate(company)
    assert read.fatturapa_regime_code == "RF01"
    assert read.country_code == "IT"

    updated = await save_company(
        db_session, CompanyInput(**{**SRL, "city": "Milano"}), SYSTEM, expected_version=1
    )
    assert updated.id == company.id
    assert updated.version == 2
    assert updated.city == "Milano"

    await db_session.flush()
    entries = (await db_session.execute(select(AuditLog).order_by(AuditLog.id))).scalars().all()
    assert [entry.action for entry in entries] == ["company.create", "company.update"]
    assert entries[1].changes == {"city": {"old": "Roma", "new": "Milano"}}
    assert entries[1].entity_id == company.id


async def test_unchanged_update_is_a_no_op(db_session: AsyncSession) -> None:
    await save_company(db_session, CompanyInput(**SRL), SYSTEM)
    same = await save_company(db_session, CompanyInput(**SRL), SYSTEM, expected_version=1)
    assert same.version == 1
    await db_session.flush()
    count = len((await db_session.execute(select(AuditLog))).scalars().all())
    assert count == 1


async def test_version_rules(db_session: AsyncSession) -> None:
    with pytest.raises(ConflictError):
        await save_company(db_session, CompanyInput(**SRL), SYSTEM, expected_version=1)
    await save_company(db_session, CompanyInput(**SRL), SYSTEM)
    with pytest.raises(ConflictError):
        await save_company(db_session, CompanyInput(**SRL), SYSTEM)
    with pytest.raises(VersionConflictError) as error:
        await save_company(
            db_session, CompanyInput(**{**SRL, "city": "Milano"}), SYSTEM, expected_version=7
        )
    assert error.value.details == {"expected_version": 7, "current_version": 1}


async def test_database_refuses_a_second_company(db_session: AsyncSession) -> None:
    await save_company(db_session, CompanyInput(**SRL), SYSTEM)
    values = {**CompanyInput(**SRL).model_dump(mode="json"), "id": uuid7(), "version": 1}
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await db_session.execute(insert(Company).values(**values))


async def test_database_enforces_regime_rule(db_session: AsyncSession) -> None:
    """The constraint holds even for writes that bypass the application schemas."""
    values = {
        **CompanyInput(**SRL).model_dump(mode="json"),
        "id": uuid7(),
        "version": 1,
        "tax_regime": "forfettario",
    }
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await db_session.execute(insert(Company).values(**values))
