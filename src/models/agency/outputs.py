# In src/models/agency/output_models.py
from pydantic import BaseModel, Field
from typing import Optional
from .responses import SingleEstateInfoResponse

class EstateInfoTableModel(BaseModel):
    estate_id: str
    estate_name_zh: Optional[str] = None
    estate_name_en: str
    region_id: str
    subregion_id: Optional[str] = None
    district_id: Optional[str] = None
    mtr_lines: Optional[str] = None
    address: Optional[str] = None
    first_op_date: Optional[str] = None
    last_op_date: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @classmethod
    def from_responses(cls, response: SingleEstateInfoResponse) -> 'EstateInfoTableModel':
        return cls(
            estate_id=response.id,
            estate_name_zh=response.name.chi,
            estate_name_en=response.name.en,
            region_id=response.region.id,
            subregion_id=response.subregion.id if response.subregion else None,
            district_id=response.district.id if response.district else None,
            mtr_lines=response.mtr_line[0].name if response.mtr_line else None,
            address=response.address,
            first_op_date=response.first_op_date,
            last_op_date=response.last_op_date,
            latitude=response.latitude,
            longitude=response.longitude,
        )

class EstateFacilitiesTableModel(BaseModel):
    estate_id: str
    facility_id: str

class EstateSchoolNetTableModel(BaseModel):
    estate_id: str
    primary_school_net_id: str
    secondary_school_net_name: str
