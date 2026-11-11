from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.company import Company
from app.schemas.company import CompanyInput
from app.services import audit
from app.services.audit import AuditContext
from app.services.common import ensure_version, flush_versioned


async def get_company(session: AsyncSession) -> Company | None:
    return (await session.execute(select(Company))).scalar_one_or_none()


async def save_company(
    session: AsyncSession,
    data: CompanyInput,
    context: AuditContext,
    *,
    expected_version: int | None = None,
) -> Company:
    """Create the company on first use, otherwise update it.

    ``expected_version`` must be omitted when creating and must match the stored
    version when updating.
    """
    values = data.model_dump(mode="json")
    company = await get_company(session)

    if company is None:
        if expected_version is not None:
            raise ConflictError("The company has not been configured yet")
        company = Company(**values)
        session.add(company)
        await flush_versioned(session)
        audit.record(
            session,
            context,
            action="company.create",
            entity_type="company",
            entity_id=company.id,
            changes=audit.diff({}, values),
        )
        return company

    if expected_version is None:
        raise ConflictError("The company already exists: send its current version to update it")
    ensure_version(company, expected_version)

    before = {key: getattr(company, key) for key in values}
    changes = audit.diff(before, values)
    if not changes:
        return company
    for key in changes:
        setattr(company, key, values[key])
    await flush_versioned(session)
    audit.record(
        session,
        context,
        action="company.update",
        entity_type="company",
        entity_id=company.id,
        changes=changes,
    )
    return company
