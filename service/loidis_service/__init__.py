"""Engine service for the Loidis Connect rota engine test (see docs/ENGINE_API.md).

The rota engine (`loidis_rota`) is imported as a library from ../engine; it is not copied.
"""

import sys
from pathlib import Path

_ENGINE = Path(__file__).resolve().parents[2] / "engine"
if str(_ENGINE) not in sys.path:
    sys.path.insert(0, str(_ENGINE))
