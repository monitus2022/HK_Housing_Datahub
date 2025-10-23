from typing import Union, Optional
from requests import Response
from pydantic import BaseModel
from logger import housing_logger
import psutil
import time
from functools import wraps


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


def txt_to_list(
    file_path: str, dtype: Union[str, int, float] = str
) -> list[Union[str, int, float]]:
    """
    Read a text file and return a list of lines.
    Each line is stripped of leading/trailing whitespace.
    """
    with open(file_path, "r", encoding="utf-8") as f:
        return [dtype(line.strip()) for line in f if line.strip()]


def parse_response(response: Response, model: BaseModel) -> Optional[BaseModel]:
    """
    Parse the JSON response and return as a Pydantic BaseModel
    """
    try:
        data = response.json()
        housing_logger.debug(f"Full JSON response for {model.__name__}: {data}")
        return model(**data)
    except ValueError as e:
        housing_logger.error(
            f"Failed to parse JSON response to pydantic model: {model.__name__}. Error: {e}"
        )
        housing_logger.debug(f"Raw response text: {response.text}")
        return None


def get_memory_usage() -> float:
    """
    Get the current system memory usage as a percentage.
    Monitoring for low memory container environments.
    """
    return psutil.virtual_memory().percent


def timer(func):
    """
    Decorator to measure the execution time of a function.
    """

    def wrapper(*args, **kwargs):
        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()
        elapsed_time = end_time - start_time
        housing_logger.info(
            f"Function {func.__name__} executed in {elapsed_time:.2f} seconds."
        )
        return result

    return wrapper


def timed_steps(func):
    """
    A decorator that times the execution of a function and allows timing
    individual steps within the function.
    """

    @wraps(func)
    def wrapper(*args, **kwargs):
        start_total = time.perf_counter()

        # Initialize a dictionary to store step timings
        wrapper.step_times = {}
        wrapper.last_step_time = start_total  # Store the start time for the first step

        def log_step(step_name):
            """
            Logs the time taken for a specific step.
            Call this within the decorated function.
            """
            current_time = time.perf_counter()
            elapsed = current_time - wrapper.last_step_time
            wrapper.step_times[step_name] = elapsed
            wrapper.last_step_time = current_time  # Update for the next step

        # Pass the log_step function to the decorated function
        result = func(*args, log_step=log_step, **kwargs)

        end_total = time.perf_counter()
        total_elapsed = end_total - start_total

        housing_logger.debug(f"Function '{func.__name__}' total time: {total_elapsed:.4f} seconds")
        for step_name, step_elapsed in wrapper.step_times.items():
            housing_logger.debug(f"  Step '{step_name}': {step_elapsed:.4f} seconds")

        return result

    return wrapper


def partition_ids(ids: list[str], partition_size: int) -> list[list[str]]:
    """
    Partition a list of IDs into smaller lists of given partition size.
    """
    return [ids[i : i + partition_size] for i in range(0, len(ids), partition_size)]


def generate_wikipedia_title_variations(title: str) -> list[str]:
    """
    Generate common Wikipedia title variations to handle case sensitivity issues.
    Wikipedia page titles are case-sensitive, so we try multiple variations.

    Args:
        title: The original title from database

    Returns:
        List of title variations to try, ordered by likelihood
    """
    variations = []

    # Original title first
    variations.append(title)

    # All uppercase (common for HK estates)
    variations.append(title.upper())

    # All lowercase
    variations.append(title.lower())

    # Title case (first letter of each word capitalized)
    variations.append(title.title())

    # Handle different dot variations (common in Chinese Wikipedia titles)
    # Replace full-width period with middle dot
    variations.append(title.replace('．', '·'))
    # Replace middle dot with full-width period
    variations.append(title.replace('·', '．'))
    # Replace regular period with middle dot
    variations.append(title.replace('.', '·'))
    # Replace regular period with full-width period
    variations.append(title.replace('.', '．'))

    # Remove trailing Roman numerals (with or without parentheses, e.g., " (II)" or " I")
    import re
    # Handle with parentheses first
    match = re.search(r'\s*\([IVXLCDM]+\)$', title)
    if match:
        variations.append(re.sub(r'\s*\([IVXLCDM]+\)$', '', title))
    # Handle without parentheses
    match = re.search(r'\s+[IVXLCDM]+$', title)
    if match:
        variations.append(re.sub(r'\s+[IVXLCDM]+$', '', title))

    # Remove duplicates while preserving order
    seen = set()
    unique_variations = []
    for variation in variations:
        if variation not in seen:
            seen.add(variation)
            unique_variations.append(variation)

    return unique_variations
