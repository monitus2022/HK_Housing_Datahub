from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class IdNameOnlyField(BaseModel):
    id: str
    name: str

class LocationField(BaseModel):
    lat: float
    lon: float

# docs/api_responses/estate_info.json--------------------------------------------

class EstateInfoResult(BaseModel):
    # Only needs IDs
    id: str
    model_config = ConfigDict(extra="ignore")

class EstateInfoResponse(BaseModel):
    count: int = Field(..., description="Total number of estates")
    result: list[Optional[EstateInfoResult]] = Field(..., description="List of estate info results")

# docs/api_responses/single_estate_info_has_phases.json----------------------------

class SingleEstateInfoResponse(BaseModel):
    id: str
    name: str
    region: IdNameOnlyField
    subregion: IdNameOnlyField
    district: IdNameOnlyField
    location: LocationField
