# Credit Card API Server

Optional backend API server for the Credit Card Recommender extension. This server provides endpoints for managing credit cards and generating recommendations.

## Features

- RESTful API for credit card CRUD operations
- Integration with Supabase for data storage
- OpenAI API integration for recommendations
- CORS support for Chrome extension
- Request logging and error handling

## Why Use This API Server?

**Option 1: Direct Supabase Access (Simpler)**
- Extension connects directly to Supabase
- OpenAI API key stored in chrome.storage (client-side)
- Fewer moving parts, easier to deploy
- Good for MVP and development

**Option 2: API Server (More Secure)**
- OpenAI API key kept server-side
- Rate limiting and request validation
- Additional business logic layer
- Better for production use

Choose based on your security and scalability needs. Both approaches work!

## Setup

### 1. Install Dependencies

```bash
cd api
npm install
```

### 2. Configure Environment Variables

The server reads from the parent `.env` file (`extension-v2/.env`). Make sure it contains:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
PORT=3000  # Optional, defaults to 3000
```

**Important:** Use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) for server-side operations.

### 3. Run the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Server will start on `http://localhost:3000`

## API Endpoints

### Health Check
```http
GET /health
```
Returns server status and timestamp.

### Get All Cards
```http
GET /api/cards
```
Returns all active credit cards from database.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Chase Freedom Flex",
      "annual_fee": 0,
      "rewards": {...},
      "description": "...",
      "is_active": true,
      "created_at": "2025-10-01T10:00:00Z",
      "updated_at": "2025-10-01T10:00:00Z"
    }
  ],
  "count": 3
}
```

### Get Card by ID
```http
GET /api/cards/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Chase Freedom Flex",
    ...
  }
}
```

### Get Recommendation
```http
POST /api/recommend
Content-Type: application/json

{
  "cartItems": ["Item 1", "Item 2"],
  "site": "amazon.com",
  "openaiKey": "sk-..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "card": "Chase Freedom Flex",
    "rewards": {
      "online": "5% cashback"
    },
    "merchant": "amazon.com",
    "category": "online shopping"
  }
}
```

### Create Card (Admin)
```http
POST /api/cards
Content-Type: application/json

{
  "name": "New Card",
  "annual_fee": 95,
  "rewards": {
    "dining": "3% cashback"
  },
  "description": "Great for dining"
}
```

### Update Card (Admin)
```http
PUT /api/cards/:id
Content-Type: application/json

{
  "annual_fee": 0,
  "is_active": true
}
```

### Delete Card (Admin)
```http
DELETE /api/cards/:id
```
Soft deletes by setting `is_active = false`.

## Testing with curl

### Get all cards
```bash
curl http://localhost:3000/api/cards
```

### Get recommendation
```bash
curl -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "cartItems": ["iPhone 15", "AirPods"],
    "site": "apple.com",
    "openaiKey": "sk-your-key-here"
  }'
```

## Integration with Extension

To use this API from the extension:

1. **Start the API server** (in development):
   ```bash
   cd api && npm run dev
   ```

2. **Update extension code** to use API endpoints instead of direct Supabase/OpenAI calls:
   ```typescript
   // In src/services/api.ts
   const response = await fetch('http://localhost:3000/api/cards');
   const { data } = await response.json();
   ```

3. **For production**, deploy the API server to:
   - Railway
   - Render
   - Heroku
   - Vercel (serverless functions)
   - AWS Lambda

## Deployment

### Deploy to Railway

1. Install Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```

2. Login and deploy:
   ```bash
   railway login
   railway init
   railway up
   ```

3. Add environment variables in Railway dashboard

### Deploy to Render

1. Create new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Set build command: `cd api && npm install`
4. Set start command: `node api/server.js`
5. Add environment variables

## Security Considerations

- **Service Role Key:** Keep secure, never expose in client-side code
- **CORS:** Currently allows all origins, restrict in production
- **Rate Limiting:** Add rate limiting middleware (e.g., express-rate-limit)
- **Authentication:** Consider adding API key authentication for write operations
- **Input Validation:** Validate all request inputs
- **Error Messages:** Don't expose sensitive info in errors

## Development vs Production

### Development
- OpenAI key passed from client (chrome.storage)
- CORS allows all origins
- Detailed error messages
- Running on localhost

### Production
- Consider moving OpenAI key to server-side env
- Restrict CORS to extension origin only
- Generic error messages
- Deployed to secure hosting
- Add rate limiting
- Add authentication for admin endpoints

## Troubleshooting

### Port already in use
Change the port:
```bash
PORT=3001 npm start
```

### Supabase connection error
- Verify credentials in `.env`
- Check Supabase project is active
- Ensure service role key is correct

### CORS errors from extension
- Make sure server is running
- Check extension manifest has correct host_permissions
- Verify CORS configuration in server.js

### OpenAI API errors
- Verify API key is valid
- Check OpenAI account has credits
- Ensure rate limits not exceeded

## Next Steps

1. Add request validation with Zod or Joi
2. Implement rate limiting
3. Add caching layer (Redis)
4. Set up logging (Winston, Pino)
5. Add API documentation (Swagger/OpenAPI)
6. Implement API key authentication
7. Add monitoring and analytics
