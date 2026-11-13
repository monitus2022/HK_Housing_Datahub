"""SQLAlchemy models for Rating and Valuation Department benchmarks."""

from sqlalchemy import Column, Float, Integer, PrimaryKeyConstraint, String
from sqlalchemy.orm import declarative_base

RvdBase = declarative_base()


class RvdRent(RvdBase):
    __tablename__ = "rvd_rents"
    region_code = Column(String, nullable=False)
    property_class = Column(String, nullable=False)
    month = Column(String, nullable=False)
    value_hkd_m2 = Column(Float)
    is_provisional = Column(Integer, nullable=False, default=0)
    __table_args__ = (
        PrimaryKeyConstraint("region_code", "property_class", "month"),
    )


class RvdPrice(RvdBase):
    __tablename__ = "rvd_prices"
    region_code = Column(String, nullable=False)
    property_class = Column(String, nullable=False)
    month = Column(String, nullable=False)
    value_hkd_m2 = Column(Float)
    is_provisional = Column(Integer, nullable=False, default=0)
    __table_args__ = (
        PrimaryKeyConstraint("region_code", "property_class", "month"),
    )


class RvdIndex(RvdBase):
    __tablename__ = "rvd_indices"
    index_type = Column(String, nullable=False)
    property_class = Column(String, nullable=False)
    month = Column(String, nullable=False)
    value = Column(Float)
    is_provisional = Column(Integer, nullable=False, default=0)
    __table_args__ = (
        PrimaryKeyConstraint("index_type", "property_class", "month"),
    )


class RvdYield(RvdBase):
    __tablename__ = "rvd_yields"
    property_class = Column(String, nullable=False)
    month = Column(String, nullable=False)
    yield_pct = Column(Float)
    is_provisional = Column(Integer, nullable=False, default=0)
    __table_args__ = (PrimaryKeyConstraint("property_class", "month"),)
