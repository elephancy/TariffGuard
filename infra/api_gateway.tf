resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "POST", "OPTIONS"]
    allow_origins     = [var.cors_origin]
    max_age           = 300
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name}-cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.dashboard.id]
    issuer   = "https://${aws_cognito_user_pool.operators.endpoint}"
  }
}

locals {
  api_routes = toset([
    "GET /health",
    "POST /client-errors",
    "POST /tariffs",
    "GET /tariffs",
    "GET /tariffs/{tariffId}/versions",
    "POST /sessions",
    "GET /sessions",
    "GET /sessions/{sessionId}",
    "POST /sessions/{sessionId}/invalidate",
    "GET /chargers/{chargerId}/sessions",
    "GET /alerts",
    "GET /audit/daily",
    "GET /overview",
    "POST /dev/seed",
    "GET /admin/users",
    "POST /admin/users",
    "POST /admin/users/{username}/status"
  ])
}

resource "aws_apigatewayv2_route" "routes" {
  for_each           = local.api_routes
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = each.value == "GET /health" ? "NONE" : "JWT"
  authorizer_id      = each.value == "GET /health" ? null : aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  # Route settings require the route to exist before AWS accepts UpdateStage.
  depends_on = [aws_apigatewayv2_route.routes]

  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.api_throttling_burst_limit
    throttling_rate_limit  = var.api_throttling_rate_limit
  }

  route_settings {
    route_key              = "POST /client-errors"
    throttling_burst_limit = min(5, var.api_throttling_burst_limit)
    throttling_rate_limit  = min(1, var.api_throttling_rate_limit)
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      sourceIp       = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      protocol       = "$context.protocol"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
    })
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
