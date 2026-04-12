# AWS Deployment Guide — RepoInsight AI

This guide walks through deploying RepoInsight AI to AWS using
ECS (Fargate), RDS (PostgreSQL), ElastiCache (Redis), and S3/CloudFront.

---

## Architecture on AWS

```
                    CloudFront (CDN)
                         |
                    ALB (HTTPS)
                   /           \
           ECS Service      ECS Service
           (Frontend)       (API + Worker)
                               |
                    ┌──────────┼──────────┐
                    │          │          │
                  RDS      ElastiCache   ECS Task
                (Postgres)  (Redis)     (ChromaDB)
```

---

## 1. Prerequisites

- AWS CLI configured (`aws configure`)
- Docker images pushed to ECR or Docker Hub
- A registered domain (optional, for HTTPS)

## 2. Database — RDS PostgreSQL

```bash
aws rds create-db-instance \
  --db-instance-identifier repoinsight-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15 \
  --master-username repoinsight \
  --master-user-password <STRONG_PASSWORD> \
  --allocated-storage 20 \
  --vpc-security-group-ids <SG_ID> \
  --db-name repoinsight \
  --backup-retention-period 7 \
  --multi-az false \
  --publicly-accessible false
```

## 3. Cache — ElastiCache Redis

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id repoinsight-redis \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-nodes 1
```

## 4. ECS Cluster

```bash
aws ecs create-cluster --cluster-name repoinsight-cluster
```

## 5. Task Definitions

Create task definition JSON files for each service (api, worker,
frontend, chroma). Key environment variables:

```json
{
  "name": "DATABASE_URL",
  "value": "postgresql+asyncpg://repoinsight:<PW>@<RDS_ENDPOINT>:5432/repoinsight"
},
{
  "name": "REDIS_URL",
  "value": "redis://<ELASTICACHE_ENDPOINT>:6379/0"
},
{
  "name": "OPENAI_API_KEY",
  "valueFrom": "arn:aws:secretsmanager:..."
}
```

Use AWS Secrets Manager for sensitive values (API keys, DB passwords).

## 6. Services

```bash
# API
aws ecs create-service \
  --cluster repoinsight-cluster \
  --service-name repoinsight-api \
  --task-definition repoinsight-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET_IDS>],securityGroups=[<SG_ID>]}" \
  --load-balancers "targetGroupArn=<TG_ARN>,containerName=api,containerPort=8000"

# Frontend
aws ecs create-service \
  --cluster repoinsight-cluster \
  --service-name repoinsight-frontend \
  --task-definition repoinsight-frontend:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "..."
```

## 7. Load Balancer

Create an Application Load Balancer (ALB) with:
- HTTPS listener on port 443 (ACM certificate)
- Target group for API (port 8000)
- Target group for Frontend (port 3000)
- Path-based routing: `/api/*` → API, `/*` → Frontend

## 8. DNS

Point your domain to the ALB using Route 53 or your DNS provider.

## 9. Monitoring

- **CloudWatch Logs**: ECS tasks auto-stream to CloudWatch
- **CloudWatch Alarms**: Set up for CPU, memory, 5xx error rates
- **X-Ray**: Enable for API tracing (optional)

---

## Cost Estimate (Minimal Setup)

| Service | Spec | Monthly |
|---|---|---|
| ECS Fargate (API) | 0.5 vCPU, 1GB × 2 | ~$30 |
| ECS Fargate (Frontend) | 0.25 vCPU, 0.5GB × 2 | ~$15 |
| RDS PostgreSQL | db.t3.micro | ~$15 |
| ElastiCache Redis | cache.t3.micro | ~$13 |
| ALB | Fixed + LCU | ~$20 |
| **Total** | | **~$93/mo** |

Scale up as needed. Use Spot Fargate for workers to reduce costs.
