# In src/models/agency/output_models.py
from pydantic import BaseModel, Field
from typing import Optional
from .responses import SingleEstateInfoResponse


class EstateBaseModel(BaseModel):
    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ):
        raise NotImplementedError("This method should be implemented in subclasses.")


class EstateInfoTableModel(EstateBaseModel):
    estate_id: str
    estate_name_zh: Optional[str] = None
    estate_name_en: str
    region_id: str
    subregion_id: Optional[str] = None
    district_id: Optional[str] = None
    address_zh: Optional[str] = None
    address_en: Optional[str] = None
    first_op_date: Optional[str] = None
    last_op_date: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> "EstateInfoTableModel":
        return cls(
            estate_id=zh_response.id,
            estate_name_zh=zh_response.name.chi,
            estate_name_en=en_response.name.en,
            region_id=zh_response.region.id,
            subregion_id=zh_response.subregion.id if zh_response.subregion else None,
            district_id=zh_response.district.id if zh_response.district else None,
            address_zh=zh_response.address,
            address_en=en_response.address,
            first_op_date=zh_response.first_op_date,
            last_op_date=zh_response.last_op_date,
            latitude=zh_response.latitude,
            longitude=zh_response.longitude,
        )


class EstateFacilitiesTableModel(BaseModel):
    estate_id: str
    facility_id: str

    @classmethod
    def from_response(
        cls, estate_id: str, facility_id: str
    ) -> "EstateFacilitiesTableModel":
        return cls(estate_id=estate_id, facility_id=facility_id)


class EstateSchoolNetTableModel(EstateBaseModel):
    estate_id: str
    school_net_id: str
    school_net_name_zh: Optional[str] = None
    school_net_name_en: Optional[str] = None

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> "EstateSchoolNetTableModel":
        return cls(
            estate_id=zh_response.id,
            school_net_id=zh_response.school_net.primary.id,
            school_net_name_zh=None,
            school_net_name_en=en_response.school_net.primary.en,
        )


class EstateMtrLineTableModel(EstateBaseModel):
    estate_id: str
    mtr_line_id: str
    mtr_line_name_zh: Optional[str] = None
    mtr_line_name_en: str

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> Optional["EstateMtrLineTableModel"]:
        # Return only the 1st MTR line for simplicity
        if zh_response.mtr_line and en_response.mtr_line:
            return cls(
                estate_id=zh_response.id,
                mtr_line_name_zh=zh_response.mtr_line[0].name,
                mtr_line_name_en=en_response.mtr_line[0].name,
            )
        return None

