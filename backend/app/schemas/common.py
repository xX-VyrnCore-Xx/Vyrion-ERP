from pydantic import BaseModel


class PageResponse[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None
