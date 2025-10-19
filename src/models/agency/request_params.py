from pydantic import BaseModel, Field
from typing import Literal


class EstateInfoRequestParams(BaseModel):
    lang: Literal["en", "zh-hk", "zh-cn"] = Field(default="en")
    hash: Literal["true", "false"] = Field(default="true")
    currency: str = Field(default="HKD")
    unit: Literal["feet", "meter"] = Field(default="feet")
    search_behavior: str = Field(default="normal")
    limit: int = Field(default=1, ge=1, le=1000)
    page: int = Field(default=1, ge=1)

class SingleEstateInfoRequestParams(BaseModel):
    lang: Literal["en", "zh-hk", "zh-cn"] = Field(default="en")