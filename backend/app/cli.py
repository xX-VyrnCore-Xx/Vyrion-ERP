"""Operational commands: ``python -m app.cli <command>``."""

import argparse
import asyncio
import getpass
import sys

from cryptography.fernet import Fernet

from app.core.config import get_database_url, get_settings
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.core.security import PasswordService
from app.db.session import create_engine, create_engine_for_url, create_session_factory
from app.services.access import sync_access_catalog
from app.services.maintenance import create_first_admin, purge_expired


async def bootstrap() -> None:
    """Bring reference data in line with the code and drop unusable auth rows.

    Idempotent; run after migrations, at every start of the server. It needs only the
    database, so it works without any application secret.
    """
    engine = create_engine_for_url(get_database_url())
    try:
        async with create_session_factory(engine)() as session, session.begin():
            await sync_access_catalog(session)
            await purge_expired(session)
    finally:
        await engine.dispose()


async def create_admin(email: str, full_name: str, password: str) -> None:
    settings = get_settings()
    passwords = PasswordService(
        time_cost=settings.argon2_time_cost,
        memory_kib=settings.argon2_memory_kib,
        parallelism=settings.argon2_parallelism,
    )
    engine = create_engine(settings)
    try:
        async with create_session_factory(engine)() as session, session.begin():
            await create_first_admin(
                session,
                passwords,
                email=email,
                full_name=full_name,
                password=password,
                min_password_length=settings.password_min_length,
            )
    finally:
        await engine.dispose()


def _read_password() -> str:
    # Never taken from the command line: it would end up in shell history and `ps`.
    first = getpass.getpass("Password: ")
    if first != getpass.getpass("Repeat password: "):
        sys.exit("The passwords do not match.")
    return first


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("bootstrap", help="synchronise permissions and system roles")
    commands.add_parser("generate-key", help="print a new encryption key (VYRION_ENCRYPTION_KEYS)")
    admin = commands.add_parser("create-admin", help="create the main administrator")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True, help="full name")
    args = parser.parse_args()

    if args.command == "generate-key":
        print(Fernet.generate_key().decode())
        return
    try:
        if args.command == "bootstrap":
            configure_logging("INFO")
            asyncio.run(bootstrap())
        elif args.command == "create-admin":
            configure_logging(get_settings().log_level)
            asyncio.run(create_admin(args.email, args.name, _read_password()))
    except AppError as error:
        # An operator needs the reason, not a stack trace.
        details = "; ".join(f"{key}: {value}" for key, value in error.details.items())
        sys.exit(f"error: {error.message}" + (f" ({details})" if details else ""))


if __name__ == "__main__":
    main()
