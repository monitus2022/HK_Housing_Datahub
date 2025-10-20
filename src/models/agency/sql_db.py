from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    PrimaryKeyConstraint,
)
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


# Location Hierarchy
class Region(Base):
    __tablename__ = "regions"
    region_id = Column(String, primary_key=True)
    region_name_zh = Column(String, nullable=False)
    region_name_en = Column(String, nullable=False)


class Subregion(Base):
    __tablename__ = "subregions"
    subregion_id = Column(String, primary_key=True)
    subregion_name_zh = Column(String, nullable=False)
    subregion_name_en = Column(String, nullable=False)
    region_id = Column(String, ForeignKey("regions.region_id"), nullable=False)


class District(Base):
    __tablename__ = "districts"
    district_id = Column(String, primary_key=True)
    district_name_zh = Column(String, nullable=False)
    district_name_en = Column(String, nullable=False)
    subregion_id = Column(String, ForeignKey("subregions.subregion_id"), nullable=False)


# Estates and Related
class Estate(Base):
    __tablename__ = "estates"
    estate_id = Column(String, primary_key=True)
    estate_name_zh = Column(String, nullable=False)
    estate_name_en = Column(String, nullable=False)
    region_id = Column(String, ForeignKey("regions.region_id"), nullable=False)
    subregion_id = Column(String, ForeignKey("subregions.subregion_id"), nullable=False)
    district_id = Column(String, ForeignKey("districts.district_id"), nullable=False)
    address_zh = Column(String)
    address_en = Column(String, nullable=False)
    first_op_date = Column(DateTime)
    last_op_date = Column(DateTime)
    latitude = Column(Float)
    longitude = Column(Float)


class EstateSchoolNet(Base):
    __tablename__ = "estate_school_nets"
    estate_id = Column(String, ForeignKey("estates.estate_id"), nullable=False)
    school_net_id = Column(String, nullable=False)
    school_net_name_zh = Column(String, nullable=False)
    school_net_name_en = Column(String, nullable=False)
    __table_args__ = (PrimaryKeyConstraint("estate_id", "school_net_id"),)


class EstateFacility(Base):
    __tablename__ = "estate_facilities"
    estate_id = Column(String, ForeignKey("estates.estate_id"), nullable=False)
    facility_id = Column(String, ForeignKey("facilities.facility_id"), nullable=False)
    __table_args__ = (PrimaryKeyConstraint("estate_id", "facility_id"),)


class Facility(Base):
    __tablename__ = "facilities"
    facility_id = Column(String, primary_key=True)
    facility_name_zh = Column(String)
    facility_name_en = Column(String, nullable=False)


class EstateMtrLine(Base):
    __tablename__ = "estate_mtr_lines"
    estate_id = Column(String, ForeignKey("estates.estate_id"), nullable=False)
    mtr_line_name_zh = Column(String)
    mtr_line_name_en = Column(String, nullable=False)
    __table_args__ = (PrimaryKeyConstraint("estate_id", "mtr_line_name_en"),)


class EstateMonthlyMarketInfo(Base):
    __tablename__ = "estate_monthly_market_info"
    estate_id = Column(String, ForeignKey("estates.estate_id"), nullable=False)
    record_date = Column(DateTime, nullable=False)
    avg_net_ft_price = Column(Float)
    avg_net_ft_rent = Column(Float)
    total_tx_count = Column(Integer)
    total_rent_tx_count = Column(Integer)
    total_tx_amount = Column(Float)
    total_rent_tx_amount = Column(Float)
    __table_args__ = (PrimaryKeyConstraint("estate_id", "record_date"),)


# Phases and Buildings
class Phase(Base):
    __tablename__ = "phases"
    phase_id = Column(String, primary_key=True)
    phase_name_zh = Column(String, nullable=False)
    phase_name_en = Column(String, nullable=False)
    estate_id = Column(String, ForeignKey("estates.estate_id"), nullable=False)


class Building(Base):
    __tablename__ = "buildings"
    building_id = Column(String, primary_key=True)
    building_name_zh = Column(String, nullable=False)
    building_name_en = Column(String, nullable=False)
    estate_id = Column(String, ForeignKey("estates.estate_id"), nullable=False)
    phase_id = Column(String, ForeignKey("phases.phase_id"))


# Units and Transactions
class Unit(Base):
    __tablename__ = "units"
    unit_id = Column(String, primary_key=True)
    floor = Column(String)
    flat = Column(String, nullable=False)
    area = Column(Float)
    net_area = Column(Float)
    bedroom = Column(Integer)
    sitting_room = Column(Integer)
    building_id = Column(String, ForeignKey("buildings.building_id"), nullable=False)


class UnitFacility(Base):
    __tablename__ = "unit_facilities"
    unit_id = Column(String, ForeignKey("units.unit_id"), nullable=False)
    facility_id = Column(String, ForeignKey("facilities.facility_id"), nullable=False)
    __table_args__ = (PrimaryKeyConstraint("unit_id", "facility_id"),)


class Transaction(Base):
    __tablename__ = "transactions"
    tx_id = Column(String, primary_key=True)
    tx_date = Column(DateTime, nullable=False)
    price = Column(Float, nullable=False)
    last_tx_date = Column(DateTime)
    gain = Column(Float)
    net_ft_price = Column(Float)
    unit_id = Column(String, ForeignKey("units.unit_id"), nullable=False)
