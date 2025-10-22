import logging
import colorlog
import os

class HousingLogger:
    def __init__(self, name: str):
        self.logger = colorlog.getLogger(name)
        self.logger.setLevel(logging.DEBUG)

        # Colored handler
        handler = colorlog.StreamHandler()
        handler.setFormatter(colorlog.ColoredFormatter(
            '%(log_color)s%(asctime)s - %(module)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s',
            log_colors={
                'DEBUG':    'cyan',
                'INFO':     'green',
                'WARNING':  'yellow',
                'ERROR':    'red',
                'CRITICAL': 'bold_red',
            }
        ))
        self.logger.addHandler(handler)

        # Set log file path
        # Check if log directory exists, if not create it
        log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        file_handler = logging.FileHandler(os.path.join(log_dir, 'hk_housing_datahub.log'))
        file_handler.setLevel(logging.ERROR)
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s - %(module)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s'
        ))
        self.logger.addHandler(file_handler)

    def get_logger(self):
        return self.logger
    
housing_logger = HousingLogger('HousingDatahub').get_logger()
