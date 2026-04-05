output "instance_id" {
  description = "ID of the EC2 instance"
  value       = aws_instance.main.id
}

output "public_ip" {
  description = "Public IP address of the EC2 instance"
  value       = aws_instance.main.public_ip
}

output "public_dns" {
  description = "Public DNS name of the EC2 instance"
  value       = aws_instance.main.public_dns
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = "ssh -i ${var.key_name}.pem ubuntu@${aws_instance.main.public_ip}"
}

output "security_group_id" {
  description = "ID of the security group"
  value       = aws_security_group.main.id
}

output "post_deploy_instructions" {
  description = "Post-deploy status"
  value       = <<-EOT

    ╔══════════════════════════════════════════════════════════════════╗
    ║  DEPLOY COMPLETE                                               ║
    ║                                                                ║
    ║  Bootstrap + sandbox setup running (~10 min).                  ║
    ║  Once done, Copilot CLI is ready inside the sandbox.           ║
    ║                                                                ║
    ║  To check progress:                                            ║
    ║    ssh -i ${var.key_name}.pem ubuntu@${aws_instance.main.public_ip}
    ║    tail -f /var/log/bootstrap.log                              ║
    ║                                                                ║
    ║  To connect to sandbox:                                        ║
    ║    export PATH=$HOME/.local/bin:$PATH                          ║
    ║    openshell sandbox connect $(cat ~/.sandbox-name)            ║
    ║                                                                ║
    ║  To start Copilot CLI (inside sandbox):                        ║
    ║    cd ~/gh-cli-telegram-extension                              ║
    ║    copilot --yolo --autopilot                                  ║
    ╚══════════════════════════════════════════════════════════════════╝

  EOT
}
