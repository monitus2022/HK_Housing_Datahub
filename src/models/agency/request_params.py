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

class EstateMonthlyMarketInfoRequestParams(BaseModel):
    lang: Literal["en", "zh-hk", "zh-cn"] = Field(default="en")
    type: Literal["estate", "phase"] = Field(default="estate")
    monthly: str = "true"
    est_ids: str = Field(default="")  # Comma-separated estate IDs

class BuildingsRequestParams(BaseModel):
    lang: Literal["en", "zh-hk", "zh-cn"] = Field(default="zh-hk")
    firsthand: Literal["true", "false"] = Field(default="false")