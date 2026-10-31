"""Cloudflare Python Worker: POST /pair, POST /rank, GET /systems.
Reached only through the API Worker's ENGINE service binding."""

import json

from workers import Response, WorkerEntrypoint

from engine import handle


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        path = "/" + request.url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]
        body = {}
        if request.method == "POST":
            body = await request.json()
        status, out = handle(path, body)
        return Response(json.dumps(out), status=status, headers={"content-type": "application/json"})
