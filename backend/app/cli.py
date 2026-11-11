"""Operational commands: ``python -m app.cli <command>``."""

import argparse
import asyncio

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import create_engine, create_session_factory
from app.services.access import sync_access_catalog


async def bootstrap() -> None:
    """Bring reference data in line with the code. Idempotent; run after migrations."""
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session, session.begin():
            await sync_access_catalog(session)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    parser.add_subparsers(dest="command", required=True).add_parser(
        "bootstrap", help="synchronise permissions and system roles"
    )
    parser.parse_args()
    configure_logging(get_settings().log_level)
    asyncio.run(bootstrap())


if __name__ == "__main__":
    main()
