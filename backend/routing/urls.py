from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health),
    path("geocode", views.geocode),
    path("trips/plan", views.plan_trip),
    path("trips/<str:trip_id>/corridor", views.corridor),
]
