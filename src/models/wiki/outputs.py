from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class WikiTable(BaseModel):
    headers: List[str]
    rows: List[List[str]]

    def to_csv_string(self) -> str:
        """Convert the table to a CSV string."""
        import csv
        import io
        output = io.StringIO()
        writer = csv.writer(output)
        if self.headers:
            writer.writerow(self.headers)
        for row in self.rows:
            writer.writerow(row)
        return output.getvalue()

class WikiSection(BaseModel):
    title: str
    text: str
    tables: Optional[List[str]] = None

class WikiPage(BaseModel):
    title: str
    sections: list[WikiSection]
