from typing import Union

def cookie_str_to_dict(cookie_str: str) -> dict[str, str]:
    """
    Convert a cookie string to a dictionary.
    Example input: "key1=value1; key2=value2; key3=value3"
    Example output: {"key1": "value1", "key2": "value2", "key3": "value3"}
    """
    cookies = {}
    for item in cookie_str.split(";"):
        if "=" in item:
            key, value = item.split("=", 1)
            cookies[key.strip()] = value.strip()
    return cookies

def txt_to_list(file_path: str, dtype: Union[str, int, float]=str) -> list[Union[str, int, float]]:
    """
    Read a text file and return a list of lines.
    Each line is stripped of leading/trailing whitespace.
    """
    with open(file_path, "r", encoding="utf-8") as f:
        return [dtype(line.strip()) for line in f if line.strip()]