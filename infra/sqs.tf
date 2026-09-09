resource "aws_sqs_queue" "validation_dlq" {
  name                              = "${local.name}-validation-dlq"
  kms_master_key_id                 = aws_kms_key.data.arn
  kms_data_key_reuse_period_seconds = 300
}

resource "aws_sqs_queue" "validation" {
  name                              = "${local.name}-validation"
  visibility_timeout_seconds        = 60
  kms_master_key_id                 = aws_kms_key.data.arn
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.validation_dlq.arn
    maxReceiveCount     = 3
  })
}
