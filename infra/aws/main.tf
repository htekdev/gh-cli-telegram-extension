terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# Latest Ubuntu 24.04 LTS AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

# SSH key pair — references an existing key pair already in AWS.
# Create one if needed:
#   aws ec2 create-key-pair --key-name gh-copilot-openclaw-key --query 'KeyMaterial' --output text > gh-copilot-openclaw-key.pem
data "aws_key_pair" "main" {
  key_name           = var.key_name
  include_public_key = false
}

# Security group allowing SSH inbound and all outbound
resource "aws_security_group" "main" {
  name        = "${var.project_name}-${var.environment}-sg"
  description = "Security group for ${var.project_name} instance (${var.environment})"

  ingress {
    description = "SSH access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

# EC2 instance
resource "aws_instance" "main" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = data.aws_key_pair.main.key_name
  vpc_security_group_ids = [aws_security_group.main.id]

  root_block_device {
    volume_size           = var.volume_size
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = templatefile("${path.module}/../shared/scripts/bootstrap.sh", {
    gh_token             = var.gh_token
    copilot_github_token = var.copilot_github_token
    telegram_bot_token   = var.telegram_bot_token
    exa_api_key          = var.exa_api_key
    perplexity_api_key   = var.perplexity_api_key
    youtube_api_key      = var.youtube_api_key
    zernio_api_key       = var.zernio_api_key
    slack_bot_token      = var.slack_bot_token
    slack_app_token      = var.slack_app_token
    project_name         = var.project_name
    git_ref              = var.git_ref
    git_repo             = var.git_repo
  })

  connection {
    type        = "ssh"
    user        = "ubuntu"
    private_key = file("${path.module}/../../${var.key_name}.pem")
    host        = self.public_ip
  }

  # Upload sandbox policy
  provisioner "file" {
    source      = "${path.module}/../shared/files/sandbox-policy.yaml"
    destination = "/home/ubuntu/sandbox-policy.yaml"
  }

  # Upload setup scripts
  provisioner "file" {
    source      = "${path.module}/../shared/scripts/setup-sandbox.sh"
    destination = "/home/ubuntu/setup-sandbox.sh"
  }

  provisioner "file" {
    source      = "${path.module}/../shared/scripts/sandbox-setup.sh"
    destination = "/home/ubuntu/sandbox-setup.sh"
  }

  provisioner "file" {
    source      = "${path.module}/../shared/scripts/reset-sandbox.sh"
    destination = "/home/ubuntu/reset-sandbox.sh"
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
  }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }
}
