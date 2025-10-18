import logging
import colorlog

import logging
import colorlog

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

    def get_logger(self):
        return self.logger
    
housing_logger = HousingLogger('HousingDatahub').get_logger()
