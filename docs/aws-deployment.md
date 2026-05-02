# Deploying RepoInsight to AWS

This is the production reference deployment. It targets a small-to-medium engineering team — a few hundred concurrent users, a few thousand indexed repositories — and costs roughly **\$90–\$120 / month** at idle. Every component scales horizontally; the cost grows linearly with traffic.

If you only want to try the project locally, stop here and use [`docker compose up`](../README.md#quick-start) instead.

---

## Contents

- [Architecture overview](#architecture-overview)
- [Before you begin](#before-you-begin)
- [Step 1 — Networking](#step-1--networking)
- [Step 2 — Database (RDS PostgreSQL)](#step-2--database-rds-postgresql)
- [Step 3 — Cache & queue (ElastiCache Redis)](#step-3--cache--queue-elasticache-redis)
- [Step 4 — Container registry (ECR)](#step-4--container-registry-ecr)
- [Step 5 — ECS cluster](#step-5--ecs-cluster)
- [Step 6 — Task definitions](#step-6--task-definitions)
- [Step 7 — ECS services](#step-7--ecs-services)
- [Step 8 — Load balancer](#step-8--load-balancer)
- [Step 9 — DNS & TLS](#step-9--dns--tls)
- [Step 10 — Monitoring](#step-10--monitoring)
- [Cost estimate](#cost-estimate)
- [Operations playbook](#operations-playbook)

---

## Architecture overview

```
                          Route 53  (yourdomain.com)
                              │
                              ▼
                       CloudFront (CDN)
                              │
                              ▼
                    Application Load Balancer
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        ECS Service      ECS Service       ECS Service
         Frontend           API              Worker
        (Fargate ×2)    (Fargate ×2)     (Fargate ×2, spot)
                              │
                  ┌───────────┼────────────┐
                  ▼           ▼            ▼
                 RDS     ElastiCache    ECS Task
              (Postgres)    (Redis)    (ChromaDB +
                                        EFS volume)
```

A few design choices worth flagging:

- **ChromaDB lives on Fargate with EFS** so vector data survives container restarts. If you outgrow this, swap in a managed vector DB (Pinecone, Qdrant Cloud, pgvector on RDS) — the application code talks to a thin abstraction.
- **Workers run on Fargate Spot.** Indexing is naturally retryable, so a 70 % cost cut is worth the occasional preemption.
- **Secrets live in AWS Secrets Manager**, never in plain task definitions.

---

## Before you begin

You'll need:

- An AWS account with admin or `PowerUserAccess` IAM permissions.
- The [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) installed and configured (`aws configure`).
- A registered domain (Route 53 or any registrar that supports custom DNS).
- Docker images for `frontend`, `api`, and `worker` ready to push to ECR.

Throughout this guide we use shell variables so you can copy-paste safely:

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export PROJECT=repoinsight
```

---

## Step 1 — Networking

Use a fresh VPC with two public and two private subnets across two availability zones. The CloudFormation template below creates everything in one shot:

```bash
aws cloudformation deploy \
  --stack-name $PROJECT-vpc \
  --template-file infra/vpc.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

If you prefer to use the default VPC, that's fine for a proof of concept — just don't ship production data through it.

---

## Step 2 — Database (RDS PostgreSQL)

```bash
aws rds create-db-instance \
  --db-instance-identifier $PROJECT-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15 \
  --master-username repoinsight \
  --master-user-password "$(openssl rand -base64 24)" \
  --allocated-storage 20 \
  --storage-type gp3 \
  --storage-encrypted \
  --vpc-security-group-ids $DB_SG_ID \
  --db-subnet-group-name $PROJECT-private \
  --db-name repoinsight \
  --backup-retention-period 7 \
  --multi-az false \
  --no-publicly-accessible
```

> **Production checklist.** Flip `--multi-az` to `true`, raise `--allocated-storage` past 50 GB to qualify for gp3's higher baseline IOPS, and store the master password in Secrets Manager rather than echoing it to your shell.

---

## Step 3 — Cache & queue (ElastiCache Redis)

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id $PROJECT-redis \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-nodes 1 \
  --security-group-ids $REDIS_SG_ID
```

For a single-node cluster, this is enough. Move to a replication group with automatic failover the moment Redis becomes load-bearing for your application.

---

## Step 4 — Container registry (ECR)

```bash
for IMG in frontend api worker; do
  aws ecr create-repository --repository-name $PROJECT/$IMG
done

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
      $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

for IMG in frontend api worker; do
  docker build -t $PROJECT/$IMG ./$IMG
  docker tag  $PROJECT/$IMG:latest \
              $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$PROJECT/$IMG:latest
  docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$PROJECT/$IMG:latest
done
```

---

## Step 5 — ECS cluster

```bash
aws ecs create-cluster \
  --cluster-name $PROJECT-cluster \
  --capacity-providers FARGATE FARGATE_SPOT
```

---

## Step 6 — Task definitions

Each service gets its own task definition. Below is the API task — the frontend and worker definitions follow the same shape with their own image, port, and command.

```json
{
  "family": "repoinsight-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/repoinsightTaskRole",
  "containerDefinitions": [{
    "name": "api",
    "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/repoinsight/api:latest",
    "portMappings": [{ "containerPort": 8000 }],
    "environment": [
      { "name": "DATABASE_URL", "value": "postgresql+asyncpg://repoinsight:..." },
      { "name": "REDIS_URL",    "value": "redis://repoinsight-redis.cache.amazonaws.com:6379/0" }
    ],
    "secrets": [
      { "name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:...:anthropic_key" },
      { "name": "JWT_SECRET",        "valueFrom": "arn:aws:secretsmanager:...:jwt_secret" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group":         "/ecs/repoinsight-api",
        "awslogs-region":        "REGION",
        "awslogs-stream-prefix": "ecs"
      }
    },
    "healthCheck": {
      "command":     ["CMD-SHELL", "curl -f http://localhost:8000/healthz || exit 1"],
      "interval":    30,
      "timeout":     5,
      "retries":     3,
      "startPeriod": 60
    }
  }]
}
```

Register every task definition with:

```bash
aws ecs register-task-definition --cli-input-json file://api.task.json
```

---

## Step 7 — ECS services

```bash
# API service — 2 tasks, attached to the API target group
aws ecs create-service \
  --cluster $PROJECT-cluster \
  --service-name $PROJECT-api \
  --task-definition $PROJECT-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$APP_SG]}" \
  --load-balancers "targetGroupArn=$API_TG_ARN,containerName=api,containerPort=8000"

# Frontend service
aws ecs create-service \
  --cluster $PROJECT-cluster \
  --service-name $PROJECT-frontend \
  --task-definition $PROJECT-frontend:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$APP_SG]}" \
  --load-balancers "targetGroupArn=$WEB_TG_ARN,containerName=frontend,containerPort=3000"

# Worker service — Spot, no load balancer
aws ecs create-service \
  --cluster $PROJECT-cluster \
  --service-name $PROJECT-worker \
  --task-definition $PROJECT-worker:1 \
  --desired-count 2 \
  --capacity-provider-strategy "capacityProvider=FARGATE_SPOT,weight=1" \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$APP_SG]}"
```

---

## Step 8 — Load balancer

Create an internet-facing Application Load Balancer with two target groups (`web` on port 3000, `api` on port 8000) and an HTTPS listener:

- `path-pattern: /api/*` → API target group
- `path-pattern: /*`     → Frontend target group

```bash
aws elbv2 create-load-balancer \
  --name $PROJECT-alb \
  --subnets $PUBLIC_SUBNETS \
  --security-groups $ALB_SG \
  --scheme internet-facing \
  --type application
```

Attach an ACM-issued TLS certificate to the listener. If your domain is in Route 53, ACM can issue and validate it automatically.

---

## Step 9 — DNS & TLS

In Route 53 (or your DNS provider), point an `A`-alias record for `repoinsight.ai` and `app.repoinsight.ai` at the ALB. ACM handles certificate renewal silently.

If you want a CDN layer in front (cheaper egress, faster TTFB for static Next.js assets), put CloudFront in between Route 53 and the ALB and forward the `Host` header.

---

## Step 10 — Monitoring

| Signal | Tool | Threshold |
| --- | --- | --- |
| Container CPU / memory | CloudWatch Container Insights | Alarm at 75 % avg over 5 min |
| 5xx error rate | ALB metrics | Alarm at >1 % over 5 min |
| Indexing job lag | Custom metric (Celery → CloudWatch) | Alarm at >10 jobs queued for 10 min |
| RDS storage | CloudWatch | Alarm at <20 % free |
| Request tracing | AWS X-Ray (optional) | Trace anything >2 s |

The Celery worker emits a `repoinsight.indexing.duration_ms` metric on every job — alert on the 95th percentile if it climbs past 60 s.

---

## Cost estimate

A baseline production deployment (two API tasks, two frontend tasks, two spot workers, single-AZ RDS, single-node Redis) lands at roughly:

| Service | Spec | Monthly |
| --- | --- | --- |
| ECS Fargate — API | 0.5 vCPU, 1 GB × 2 | ~\$30 |
| ECS Fargate — Frontend | 0.25 vCPU, 0.5 GB × 2 | ~\$15 |
| ECS Fargate Spot — Workers | 0.5 vCPU, 1 GB × 2 | ~\$10 |
| RDS PostgreSQL | db.t3.micro | ~\$15 |
| ElastiCache Redis | cache.t3.micro | ~\$13 |
| Application Load Balancer | Fixed + LCU | ~\$20 |
| Data transfer | ~10 GB egress | ~\$1 |
| **Total** | | **~\$104 / month** |

CloudWatch Logs + ECR storage + Secrets Manager add another \$5–\$10. Multi-AZ RDS roughly doubles the database line. Heavy indexing usage scales the Anthropic API spend independently — that's a per-token cost paid directly to Anthropic, not AWS.

---

## Operations playbook

**Rolling deploy.** Push a new image to ECR, then bump the task definition revision and call `aws ecs update-service --force-new-deployment`. ECS drains old tasks and starts new ones automatically.

**Database migrations.** Run `alembic upgrade head` from a one-shot Fargate task that uses the same task role as the API. Don't bake migrations into the API container's startup command — a bad migration would prevent rollbacks.

**Restoring from backup.** RDS snapshots are taken nightly. Restore with `aws rds restore-db-instance-from-db-snapshot`; ChromaDB lives on EFS, which has its own daily AWS Backup schedule.

**Scaling under load.** Both API and frontend services have auto-scaling policies tied to ALB request count. Workers scale on Celery queue depth (`redis-cli LLEN celery`).

---

If anything in this guide breaks, please [open an issue](https://github.com/yourname/repoinsight-ai/issues) — the AWS API moves fast and small flag names change.
