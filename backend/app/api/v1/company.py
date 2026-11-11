from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, require
from app.core.errors import NotFoundError
from app.schemas.company import CompanyInput, CompanyRead
from app.services import company as company_service
from app.services.authz import AuthContext

router = APIRouter(prefix="/company", tags=["company"])

ViewCompany = Annotated[AuthContext, Depends(require("core.company:view"))]
UpdateCompany = Annotated[AuthContext, Depends(require("core.company:update"))]


class CompanySave(CompanyInput):
    """Omit ``version`` to create the company, send the current one to update it."""

    version: int | None = None


@router.get("", response_model=CompanyRead)
async def get_company(_: ViewCompany, session: SessionDep) -> CompanyRead:
    company = await company_service.get_company(session)
    if company is None:
        raise NotFoundError("The company has not been configured yet")
    return CompanyRead.model_validate(company)


@router.put("", response_model=CompanyRead)
async def save_company(body: CompanySave, actor: UpdateCompany, session: SessionDep) -> CompanyRead:
    data = CompanyInput.model_validate(body.model_dump(exclude={"version"}))
    company = await company_service.save_company(
        session, data, actor.audit(), expected_version=body.version
    )
    await session.commit()
    return CompanyRead.model_validate(company)
