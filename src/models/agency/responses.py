from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, Union


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
    secondary: Optional[NameOnlyField] = None


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
    school_net: Optional[SingleEstateInfoSchoolNetField] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    phase: list[SingleEstateInfoPhaseField]


# docs/api_responses/estate_monthly_market_info.json----------------------------


class EstateMonthlyMarketInfoRecord(IgnoreExtraModel):
    date: str
    avg_ft_price: Optional[float] = None
    avg_net_ft_price: Optional[float] = None
    max_ft_price: Optional[float] = None
    max_net_ft_price: Optional[float] = None
    min_ft_price: Optional[float] = None
    min_net_ft_price: Optional[float] = None
    avg_ft_rent: Optional[float] = None
    avg_net_ft_rent: Optional[float] = None
    max_ft_rent: Optional[float] = None
    max_net_ft_rent: Optional[float] = None
    min_ft_rent: Optional[float] = None
    min_net_ft_rent: Optional[float] = None
    total_tx_count: Optional[int] = None
    total_rent_tx_count: Optional[int] = None
    total_tx_amount: Optional[float] = None
    total_rent_tx_amount: Optional[float] = None


class EstateMonthlyMarketInfoResponse(IgnoreExtraModel):
    id: str
    monthly: list[EstateMonthlyMarketInfoRecord]


EstateMonthlyMarketInfoResponses = list[EstateMonthlyMarketInfoResponse]

# docs/api_responses/transactions.json----------------------------


class TransactionsDetailField(IgnoreExtraModel):
    id: str
    tx_date: str
    feature: Optional[list[IdNameOnlyField]] = None
    price: float
    last_tx_date: Optional[str] = None
    gain: Optional[float] = None
    bedroom: Optional[int] = None
    sitting_room: Optional[int] = None
    net_ft_price: Optional[float] = None


class UnitInfoField(IgnoreExtraModel):
    unit_id: str
    floor: str
    flat: str
    area: Optional[float] = None
    net_area: Optional[float] = None
    transactions: list[TransactionsDetailField] = []


class BuildingInfoResponse(IgnoreExtraModel):
    building: IdNameOnlyField
    data: list[UnitInfoField]
