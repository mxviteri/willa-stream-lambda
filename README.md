# Willa Backend - AWS Lambda Module

A Node.js module designed for AWS Lambda deployment with API Gateway integration. This module uses ES modules (.mjs files) and provides utilities for parsing query parameters and handling API Gateway requests.

## Features

- ✅ ES Module support (.mjs files)
- ✅ Query parameter parsing from API Gateway events
- ✅ Path parameter parsing
- ✅ Request body parsing
- ✅ Standardized error and success responses
- ✅ CORS headers included
- ✅ Comprehensive testing suite
- ✅ Ready for AWS Lambda deployment

## Project Structure

```
willa-backend/
├── src/
│   ├── handler.mjs          # Main Lambda handler
│   └── utils.mjs            # Utility functions
├── test/
│   └── test.mjs             # Test suite
├── package.json             # NPM configuration
├── README.md               # This file
└── .gitignore             # Git ignore rules
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Tests

```bash
npm test
```

### 3. Test Locally

```bash
node test/test.mjs
```

## Usage

### Lambda Handler

The main handler function is located in `src/handler.mjs`:

```javascript
import { handler } from './src/handler.mjs';

// AWS Lambda will call this function
export { handler };
```

### Query Parameter Parsing

The module automatically parses query parameters from API Gateway events:

```javascript
// Example API Gateway event
const event = {
  queryStringParameters: {
    name: 'test',
    value: '123'
  }
};

// The handler will parse these automatically
const queryParams = parseQueryParams(event);
// Result: { name: 'test', value: '123' }
```

### Custom Processing

Modify the `processQueryParams` function in `src/handler.mjs` to implement your specific business logic:

```javascript
async function processQueryParams(queryParams) {
  // Add your custom logic here
  return {
    // Your processed data
  };
}
```

## Deployment to AWS Lambda

### 1. Package the Code

```bash
npm run package
```

This creates a `lambda-deployment.zip` file containing your code.

### 2. AWS Lambda Configuration

- **Runtime**: Node.js 18.x or later
- **Handler**: `src/handler.handler`
- **Memory**: 128 MB (adjust as needed)
- **Timeout**: 30 seconds (adjust as needed)

### 3. Upload to Lambda

You can upload the zip file through:
- AWS Console
- AWS CLI
- AWS SAM
- Terraform
- Other IaC tools

### 4. API Gateway Integration

Configure API Gateway to:
- Use Lambda proxy integration
- Set the Lambda function as the target
- Configure CORS if needed (headers are already included in responses)

## API Gateway Event Structure

The handler expects API Gateway events with this structure:

```javascript
{
  "httpMethod": "GET",
  "path": "/api/endpoint",
  "queryStringParameters": {
    "param1": "value1",
    "param2": "value2"
  },
  "pathParameters": {
    "id": "123"
  },
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"key\": \"value\"}" // For POST requests
}
```

## Response Format

### Success Response (200)

```json
{
  "message": "Success",
  "queryParams": {
    "param1": "value1"
  },
  "result": {
    "receivedParams": {...},
    "paramCount": 1,
    "hasRequiredParams": true,
    "processedAt": "2024-01-01T00:00:00.000Z"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Error Response (500)

```json
{
  "message": "Internal server error",
  "error": "Error description"
}
```

## Utility Functions

The `src/utils.mjs` module provides several utility functions:

- `parseQueryParams(event)` - Parse query parameters
- `parsePathParams(event)` - Parse path parameters
- `parseRequestBody(event)` - Parse request body
- `getHttpMethod(event)` - Get HTTP method
- `getRequestPath(event)` - Get request path
- `createErrorResponse(statusCode, message, details)` - Create error response
- `createSuccessResponse(data, statusCode)` - Create success response

## Development

### Adding Dependencies

```bash
npm install package-name
```

### Running Tests

```bash
npm test
```

### Local Testing

Create a test event file and run:

```bash
node -e "
import { handler } from './src/handler.mjs';
const testEvent = { queryStringParameters: { test: 'value' } };
handler(testEvent, {}).then(console.log);
"
```

## Environment Variables

You can access environment variables in your Lambda function:

```javascript
const apiKey = process.env.API_KEY;
const environment = process.env.NODE_ENV;
```

## Security Considerations

- Always validate and sanitize input parameters
- Use environment variables for sensitive data
- Implement proper error handling
- Consider rate limiting for API Gateway
- Use IAM roles with minimal required permissions

## Troubleshooting

### Common Issues

1. **Module not found**: Ensure all files use `.mjs` extension
2. **Import errors**: Check that `"type": "module"` is in package.json
3. **Timeout errors**: Increase Lambda timeout or optimize code
4. **Memory errors**: Increase Lambda memory allocation

### Debugging

Enable CloudWatch logs to see console output:

```javascript
console.log('Debug info:', JSON.stringify(data, null, 2));
```

## License

MIT License - see LICENSE file for details. 