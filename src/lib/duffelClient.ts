export interface FlightSearchRequest {
  origin: string;
  destination: string;
  departureDate: string;
  passengers: number;
}

export interface FlightSearchResponse {
  offers: any[];
  error?: string;
}

export interface BookingRequest {
  offerId: string;
  passengerDetails: any[];
}

export interface BookingResponse {
  bookingId: string;
  status: string;
  error?: string;
}

const API_BASE = '/api/flights';

export const duffelClient = {
  async searchFlights(request: FlightSearchRequest): Promise<FlightSearchResponse> {
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Flight search request failed: ${res.status}`);
    return res.json();
  },

  async bookFlight(request: BookingRequest): Promise<BookingResponse> {
    const res = await fetch(`${API_BASE}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Flight booking request failed: ${res.status}`);
    return res.json();
  },
};
