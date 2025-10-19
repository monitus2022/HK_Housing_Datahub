from pydantic import BaseModel, ConfigDict, Field
from typing import Optional


class IgnoreExtraModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class IdNameOnlyField(IgnoreExtraModel):
    id: str
    name: str


class IdOnlyField(IgnoreExtraModel):
    id: str


class NameOnlyField(IgnoreExtraModel):
    name: str


class LocationField(IgnoreExtraModel):
    lat: float
    lon: float


# docs/api_responses/estate_info.json--------------------------------------------


class EstateInfoResponse(IgnoreExtraModel):
    count: int = Field(..., description="Total number of estates")
    result: list[Optional[IdOnlyField]] = Field(
        ..., description="List of estate info results"
    )


# docs/api_responses/single_estate_info_has_phases.json----------------------------


class SingleEstateInfoNameField(IgnoreExtraModel):
    chi: Optional[str] = Field(None, description="Chinese name of the estate")
    en: str = Field(..., description="English name of the estate")


class SingleEstateInfoMarketStatField(IgnoreExtraModel):
    net_ft_price: Optional[float] = None
    pre_net_ft_price: Optional[float] = None
    tx_count: Optional[int] = None
    net_ft_price_chg: Optional[float] = None
    tx_amount: Optional[float] = None


class SingleEstateInfoSchoolNetField(IgnoreExtraModel):
    primary: IdOnlyField
    secondary: NameOnlyField


class SingleEstateInfoPhaseField(IgnoreExtraModel):
    is_phase: bool = Field(..., description="Indicates if this is a phase")
    buildings: Optional[list[IdNameOnlyField]] = Field(
        None, description="List of buildings in the phase"
    )

    # If phase, include phase-specific fields
    id: Optional[str] = Field(None, description="Phase ID")
    name: Optional[str] = Field(None, description="Phase name")


class SingleEstateInfoResponse(IgnoreExtraModel):
    id: str
    name: SingleEstateInfoNameField
    market_stat: Optional[SingleEstateInfoMarketStatField] = None
    region: IdNameOnlyField
    subregion: Optional[IdNameOnlyField] = None
    district: IdNameOnlyField
    mtr_line: Optional[list[NameOnlyField]] = None
    address: str
    first_op_date: Optional[str] = None
    last_op_date: Optional[str] = None
    facilityGroup: Optional[list[IdNameOnlyField]] = None
    misc: Optional[list[IdNameOnlyField]] = None
    school_net: SingleEstateInfoSchoolNetField
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    phase: Optional[list[SingleEstateInfoPhaseField]] = None
