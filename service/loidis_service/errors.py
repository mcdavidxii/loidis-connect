"""Errors whose message is safe to show the user: counts, column names and IDs only."""


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status
