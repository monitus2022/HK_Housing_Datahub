import mwparserfromhell
import re
from logger import housing_logger
from typing import Optional
from models.wiki.outputs import WikiPage, WikiSection, WikiTable
from processors.base import BaseProcessor
from wikipediaapi import WikipediaPage


class WikiProcessor(BaseProcessor):
    """
    Wikipedia Processor to parse Estate information from crawled data.
    Processes sections, extracts text, and parses tables.
    """

    def __init__(self):
        super().__init__()

    def _create_data_cache(self):
        """Create data cache if needed."""
        pass

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
                    expanded_row.append(expanded_rows[-row_spans[col_idx]][col_idx])
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
                    expanded_row.append(expanded_rows[-row_spans[col_idx]][col_idx])
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
        self, page_content: WikipediaPage, section_title: str, wikitext: Optional[str] = None
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
            output = WikiSection(title=section.title, text=section_text)
            if tables:
                output.tables = tables
            sections.append(output.model_dump())
        return WikiPage(title=page_content.title, sections=sections).model_dump()