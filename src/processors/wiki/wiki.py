import mwparserfromhell
import re
from logger import housing_logger
from typing import Optional
from models.wiki.outputs import WikiTable
from processors.base import BaseProcessor
from wikipediaapi import WikipediaPage
from config import housing_datahub_config
import time


class WikiProcessor(BaseProcessor):
    """
    Wikipedia Processor to parse Estate information from crawled data.
    Processes sections, extracts text, and parses tables.
    """

    def __init__(self):
        super().__init__()
        self._set_wiki_file_paths()
        self._create_data_cache()

    def _create_data_cache(self):
        self.data_cache = {}

    def _set_wiki_file_paths(self) -> None:
        self.wiki_data_storage_path = (
            self.data_storage_path / housing_datahub_config.storage.wiki.path
        )
        if not self.wiki_data_storage_path.exists():
            try:
                self.wiki_data_storage_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                housing_logger.error(
                    f"Failed to create directory {self.wiki_data_storage_path}: {e}"
                )
        self.wiki_data_file_path = (
            self.wiki_data_storage_path
            / housing_datahub_config.storage.wiki.files["pages"]
        )

    def _parse_tables_from_wikitext(self, wikitext: str) -> list[str]:
        """Parse tables from wiki markup text, handling colspan and rowspan by expanding cells."""
        parsed = mwparserfromhell.parse(wikitext)
        csv_tables = []
        table_nodes = self._extract_table_nodes(parsed)
        for table_node in table_nodes:
            rows = self._parse_table_rows(table_node)
            if not rows:
                continue
            expanded_rows = self._expand_table(rows)
            if expanded_rows:
                headers = expanded_rows[0]
                data_rows = expanded_rows[1:]
            else:
                headers = []
                data_rows = expanded_rows
            csv_string = self._table_to_csv(headers, data_rows)
            csv_tables.append(csv_string)
        return csv_tables

    def _extract_table_nodes(self, parsed):
        """Extract table nodes from parsed wikitext."""
        return parsed.filter_tags(matches=lambda node: node.tag == "table")

    def _clean_wiki_text(self, text: str) -> str:
        """Clean wiki markup from text, such as links and HTML tags."""
        import re
        # Remove wiki links: [[link|text]] -> text
        text = re.sub(r'\[\[([^|]+)\|([^]]+)\]\]', r'\2', text)
        # Remove simple wiki links: [[text]] -> text
        text = re.sub(r'\[\[([^]]+)\]\]', r'\1', text)
        # Remove <br> tags
        text = re.sub(r'<br\s*/?>', '', text)
        # Remove other common HTML tags if present
        text = re.sub(r'<[^>]+>', '', text)
        return text.strip()

    def _parse_table_rows(self, table_node):
        """Parse rows and cells from a table node, extracting text, colspan, and rowspan."""
        rows = []
        for row_node in table_node.contents.filter_tags(
            matches=lambda node: node.tag == "tr"
        ):
            row_cells = []
            for cell_node in row_node.contents.filter_tags(
                matches=lambda node: node.tag in ["td", "th"]
            ):
                cell_text = str(cell_node.contents).strip()
                cell_text = self._clean_wiki_text(cell_text)
                colspan = self._get_colspan(cell_node)
                rowspan = self._get_rowspan(cell_node)
                row_cells.append((cell_text, colspan, rowspan))
            if row_cells:
                rows.append(row_cells)
        return rows

    def _get_colspan(self, cell_node):
        """Extract colspan from cell node."""
        if "colspan=" in str(cell_node):
            match = re.search(r'colspan="(\d+)"', str(cell_node))
            if match:
                return int(match.group(1))
        return 1

    def _get_rowspan(self, cell_node):
        """Extract rowspan from cell node."""
        if "rowspan=" in str(cell_node):
            match = re.search(r'rowspan="(\d+)"', str(cell_node))
            if match:
                return int(match.group(1))
        return 1

    def _expand_table(self, rows):
        """Expand table rows to handle colspan and rowspan."""
        if not rows:
            return []
        # Determine max columns
        max_cols = max(sum(colspan for _, colspan, _ in row) for row in rows)

        expanded_rows = []
        row_spans = [0] * max_cols  # Track rowspan for each column

        for row in rows:
            expanded_row = []
            col_idx = 0
            for cell_text, colspan, rowspan in row:
                # Skip columns occupied by rowspan
                while col_idx < max_cols and row_spans[col_idx] > 0:
                    # Check if we have enough previous rows for the rowspan reference
                    if len(expanded_rows) > row_spans[col_idx]:
                        expanded_row.append(expanded_rows[-row_spans[col_idx]][col_idx])
                    else:
                        expanded_row.append("")  # Fallback for invalid rowspan reference
                    row_spans[col_idx] -= 1
                    col_idx += 1
                # Add the cell, expanded for colspan
                for _ in range(colspan):
                    expanded_row.append(cell_text)
                    if rowspan > 1:
                        row_spans[col_idx] = rowspan - 1
                    col_idx += 1
            # Fill remaining columns with rowspan values
            while col_idx < max_cols:
                if row_spans[col_idx] > 0:
                    # Check if we have enough previous rows for the rowspan reference
                    if len(expanded_rows) > row_spans[col_idx]:
                        expanded_row.append(expanded_rows[-row_spans[col_idx]][col_idx])
                    else:
                        expanded_row.append("")  # Fallback for invalid rowspan reference
                    row_spans[col_idx] -= 1
                else:
                    expanded_row.append("")
                col_idx += 1
            expanded_rows.append(expanded_row)
        return expanded_rows

    def _table_to_csv(self, headers, data_rows):
        """Convert table headers and rows to CSV string."""
        table = WikiTable(headers=headers, rows=data_rows)
        return table.to_csv_string()

    def _get_section_wikitext(
        self,
        page_content: WikipediaPage,
        section_title: str,
        wikitext: Optional[str] = None,
    ) -> str:
        """Get the raw wikitext for a specific section."""
        # If wikitext is provided (from crawler), use it
        if wikitext:
            return wikitext

        # Find the section index
        section_index = None
        for i, section in enumerate(page_content.sections):
            if section.title == section_title:
                section_index = i
                break
        if section_index is None:
            return ""

        # Fallback: return parsed text
        return page_content.sections[section_index].text

    def process_page_content(
        self, page_content: WikipediaPage, section_wikitexts: Optional[dict] = None
    ) -> Optional[dict]:
        sections = []
        all_tables = []
        section_wikitexts = section_wikitexts or {}

        for section in page_content.sections:
            section_text = section.text
            # Always include 1 level subsections' text
            if not section_text.strip():
                continue
            if section.sections:
                for subsection in section.sections:
                    section_text += f"\n{subsection.text}"
            # Get raw wikitext for table parsing (from provided data or fallback)
            section_wikitext = self._get_section_wikitext(
                page_content, section.title, section_wikitexts.get(section.title)
            )
            # Parse tables from the raw wikitext
            tables = self._parse_tables_from_wikitext(section_wikitext)
            if tables:
                all_tables.extend(tables)
            # For normal sections, only title and text fields are kept
            sections.append({"title": section.title, "text": section_text})
        # If tables are found, save them into tables on same level of sections in the dict
        result = {"title": page_content.title, "sections": sections}
        if all_tables:
            result["tables"] = all_tables
        return result
