import 'dotenv/config';

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

export class DuffelManager {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.DUFFEL_API_KEY || '';
  }

  private async request(endpoint: string, method: 'GET' | 'POST', body?: any) {
    if (!this.apiKey) {
      throw new Error('DUFFEL_API_KEY is not configured in environment variables.');
    }

    const response = await fetch(`https://api.duffel.com${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Duffel-Version': 'v1',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `Duffel API error: ${response.status}`);
    }

    return response.json();
  }

  async searchFlights(req: FlightSearchRequest): Promise<FlightSearchResponse> {
    try {
      // Duffel search typically requires a 'flight_offer_request'
      const data = await this.request('/flight-offers/search', 'POST', {
        data: {
          slices: [
            {
              origin: req.origin,
              destination: req.destination,
              departure_date: {
                // Duffel expects ISO 8601 date string (YYYY-MM-DD)
                year: parseInt(req.departureDate.split('-')[0]),
                month: parseInt(req.departureDate.split('-')[1]),
                day: parseInt(req.departureDate.split('-')[2]),
              },
            },
          ],
          passengers: Array(req.passengers).fill({
            type: 'adult',
          }),
        },
      });

      return { offers: data.data?.offers || [] };
    } catch (err: any) {
      return { offers: [], error: err.message };
    }
  }

  async bookFlight(req: BookingRequest): Promise<BookingResponse> {
    try {
      const data = await this.request('/orders', 'POST', {
        data: {
          offer_id: req.offerId,
          passengers: req.passengerDetails,
        },
      });

      return {
        bookingId: data.data?.id || 'unknown',
        status: data.data?.status || 'created',
      };
    } catch (err: any) {
      return { bookingId: '', status: 'failed', error: err.message };
    }
  }
}

export const duffelManager = new DuffelManager();
