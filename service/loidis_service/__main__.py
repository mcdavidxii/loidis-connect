"""python -m loidis_service [--host 127.0.0.1] [--port 8000]

Starts the service with access logging off (so no request line is ever logged). Set
ENGINE_FAKE_API=1 to serve made-up CareLineLive data and never touch the network.
"""

import argparse
import logging


def main() -> None:
    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    uvicorn.run("loidis_service.app:app", host=args.host, port=args.port, access_log=False, log_level="info")


if __name__ == "__main__":
    main()
