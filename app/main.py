from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import database
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield


app = FastAPI(
    title="Compliance Platform — Video Evidence",
    description="Local video interaction analysis for human evidence review. Detections do not establish regulatory compliance.",
    version="0.1.0",
    lifespan=lifespan,
)


app.include_router(router)
