<!-- dsh/README.md — 占位；dsh/ 被 .gitignore 排除 -->
# dsh 上游检出货架

按批准的 commit 克隆上游源码（build-image.sh 校验 commit 一致）：

    git clone https://github.com/deepseek-ai/deepseek-harness.git dsh
    git -C dsh checkout 47f943859bef60e4160492346772ded9b24f765a
