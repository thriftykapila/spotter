from urllib.parse import quote

from rest_framework.test import APIClient


def test_signed_sample_survives_rewrite_url_escaping():
    client = APIClient()
    response = client.post("/api/trips/plan", {"mode": "sample"}, format="json")
    assert response.status_code == 200
    identifier = response.json()["id"]
    # Vercel's external rewrite can escape an already escaped route parameter.
    transported = quote(quote(identifier, safe=""), safe="")
    assert transported == identifier
    corridor = APIClient().get(f"/api/trips/{transported}/corridor")
    assert corridor.status_code == 200
    assert len(corridor.json()["hours"]) == 49
