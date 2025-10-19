from pydantic import BaseModel
from typing import Optional
from .responses import SingleEstateInfoResponse
from logger import housing_logger


class SingleLanguageBaseModel(BaseModel):
    @classmethod
    def from_response(cls, response: SingleEstateInfoResponse):
        raise NotImplementedError("This method should be implemented in subclasses.")


class BilingualBaseModel(BaseModel):
    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ):
        raise NotImplementedError("This method should be implemented in subclasses.")


class EstateInfoTableModel(BilingualBaseModel):
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
        cls, response: SingleEstateInfoResponse
    ) -> Optional[list["EstateFacilitiesTableModel"]]:
        facilities = response.facilityGroup or []
        if not facilities:
            return None
        return [
            cls(
                estate_id=response.id,
                facility_id=facility.id,
            )
            for facility in facilities
        ]


class EstateSchoolNetTableModel(BilingualBaseModel):
    estate_id: str
    school_net_id: str
    school_net_name_zh: Optional[str] = None
    school_net_name_en: Optional[str] = None

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> Optional["EstateSchoolNetTableModel"]:
        if not zh_response.school_net or not en_response.school_net:
            return None
        return cls(
            estate_id=zh_response.id,
            school_net_id=zh_response.school_net.primary.id,
            school_net_name_zh=zh_response.school_net.secondary.name if zh_response.school_net.secondary else None,
            school_net_name_en=en_response.school_net.secondary.name if en_response.school_net.secondary else None
        )


class EstateMtrLineTableModel(BilingualBaseModel):
    estate_id: str
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


class FacilitiesTableModel(BilingualBaseModel):
    facility_id: str
    facility_name_zh: Optional[str] = None
    facility_name_en: str

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> "FacilitiesTableModel":
        zh_facilities, en_facilities = (
            zh_response.facilityGroup,
            en_response.facilityGroup,
        )
        if not zh_facilities or not en_facilities:
            return None
        facilities = []
        for zh_facility, en_facility in zip(zh_facilities, en_facilities):
            if zh_facility.id == en_facility.id:
                facilities.append(
                    cls(
                        facility_id=zh_facility.id,
                        facility_name_zh=zh_facility.name if zh_facility.name else None,
                        facility_name_en=en_facility.name if en_facility.name else None,
                    )
                )
        return facilities

class RegionsTableModel(BilingualBaseModel):
    region_id: str
    region_name_zh: str
    region_name_en: str

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> "RegionsTableModel":
        return cls(
            region_id=zh_response.region.id,
            region_name_zh=zh_response.region.name,
            region_name_en=en_response.region.name,
        )

class SubregionsTableModel(BilingualBaseModel):
    subregion_id: str
    subregion_name_zh: Optional[str] = None
    subregion_name_en: Optional[str] = None

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> Optional["SubregionsTableModel"]:
        if zh_response.subregion and en_response.subregion:
            return cls(
                subregion_id=zh_response.subregion.id,
                subregion_name_zh=zh_response.subregion.name,
                subregion_name_en=en_response.subregion.name,
            )
        return None

class DistrictsTableModel(BilingualBaseModel):
    district_id: str
    district_name_zh: Optional[str] = None
    district_name_en: Optional[str] = None

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> Optional["DistrictsTableModel"]:
        if zh_response.district and en_response.district:
            return cls(
                district_id=zh_response.district.id,
                district_name_zh=zh_response.district.name,
                district_name_en=en_response.district.name,
            )
        return None
    
class PhasesTableModel(BilingualBaseModel):
    phase_id: str
    phase_name_zh: Optional[str] = None
    phase_name_en: Optional[str] = None
    estate_id: str

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> Optional[list["PhasesTableModel"]]:
        if not zh_response.phase or not en_response.phase:
            return None
        phases = []
        for single_phase_zh, single_phase_en in zip(zh_response.phase, en_response.phase):
            if not single_phase_zh.is_phase or not single_phase_en.is_phase:
                continue
            single_phase = cls(
                phase_id=single_phase_zh.id,
                phase_name_zh=single_phase_zh.name if single_phase_zh.name else None,
                phase_name_en=single_phase_en.name if single_phase_en.name else None,
                estate_id=zh_response.id,
            )
            phases.append(single_phase)
        return phases

class BuildingsTableModel(BilingualBaseModel):
    building_id: str
    building_name_zh: str
    building_name_en: str
    estate_id: str
    phase_id: Optional[str] = None

    @classmethod
    def from_both_responses(
        cls,
        zh_response: SingleEstateInfoResponse,
        en_response: SingleEstateInfoResponse,
    ) -> Optional[list["BuildingsTableModel"]]:
        if not zh_response.phase or not en_response.phase:
            return None
        buildings = []
        for single_phase_zh, single_phase_en in zip(zh_response.phase, en_response.phase):
            if not single_phase_zh.buildings or not single_phase_en.buildings:
                continue
            for building_zh, building_en in zip(single_phase_zh.buildings, single_phase_en.buildings):
                if building_zh.id == building_en.id:
                    building = cls(
                        building_id=building_zh.id,
                        building_name_zh=building_zh.name if building_zh.name else None,
                        building_name_en=building_en.name if building_en.name else None,
                        estate_id=zh_response.id,
                        phase_id=single_phase_zh.id,
                    )
                    buildings.append(building)
        return buildings