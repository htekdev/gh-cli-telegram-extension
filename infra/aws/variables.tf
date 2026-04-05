variable "region" {
  description = "AWS region to deploy resources in"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.medium"
}

variable "key_name" {
  description = "Name of the AWS key pair to use for SSH access"
  type        = string
  default     = "gh-copilot-openclaw-key"
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed to SSH into the instance. Restrict this to your IP (e.g. 203.0.113.42/32) for production use."
  type        = string
  default     = "0.0.0.0/0"
}

variable "volume_size" {
  description = "Size of the root EBS volume in GB"
  type        = number
  default     = 20
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "gh-copilot-cli-telegram-bridge"
}

variable "environment" {
  description = "Deployment environment (prod or dev)"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "dev"], var.environment)
    error_message = "Environment must be 'prod' or 'dev'."
  }
}

# ── API Keys ─────────────────────────────────────────────────────────────────

variable "gh_token" {
  description = "GitHub PAT for gh CLI auth"
  type        = string
  sensitive   = true
}

variable "copilot_github_token" {
  description = "GitHub PAT with Copilot permissions for inference"
  type        = string
  sensitive   = true
}

variable "telegram_bot_token" {
  description = "Telegram bot token from @BotFather"
  type        = string
  sensitive   = true
}

variable "exa_api_key" {
  description = "Exa API key for web search"
  type        = string
  sensitive   = true
}

variable "perplexity_api_key" {
  description = "Perplexity API key for AI-powered search"
  type        = string
  sensitive   = true
}

variable "youtube_api_key" {
  description = "YouTube Data API v3 key"
  type        = string
  sensitive   = true
}

variable "zernio_api_key" {
  description = "Zernio API key for social media management"
  type        = string
  sensitive   = true
}
