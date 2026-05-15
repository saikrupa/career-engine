"""Connector exports and factory mapping."""

from .adp import AdpConnector
from .ashby import AshbyConnector
from .greenhouse import GreenhouseConnector
from .icims import IcimsConnector
from .lever import LeverConnector
from .successfactors import SuccessFactorsConnector
from .taleo import TaleoConnector
from .ukg import UkgConnector
from .workday import WorkdayConnector

CONNECTOR_MAP = {
    "workday": WorkdayConnector,
    "taleo": TaleoConnector,
    "successfactors": SuccessFactorsConnector,
    "icims": IcimsConnector,
    "ukg": UkgConnector,
    "adp": AdpConnector,
    "greenhouse": GreenhouseConnector,
    "lever": LeverConnector,
    "ashby": AshbyConnector,
}
