from pydantic import BaseModel, Field
from typing import Literal


class WikiPageRequestParams(BaseModel):
    action: Literal["parse"] = Field(default="parse")
    page: str
    prop: Literal["wikitext", "text", "sections"] = Field(default="wikitext")
    section: int | None = None
    format: Literal["json"] = Field(default="json")
