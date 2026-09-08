# 示例：zmind.so 的完整 server 配置（含 WebSocket 反代）
server {
    listen 80;
    listen 443 ssl http2;
    server_name zmind.so www.zmind.so;

    access_log /www/sites/zmind.so/log/access.log main;
    error_log  /www/sites/zmind.so/log/error.log;

    # SSL
    ssl_certificate     /www/sites/zmind.so/ssl/fullchain.pem;
    ssl_certificate_key /www/sites/zmind.so/ssl/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # 放大缓冲
    proxy_buffer_size   256k;
    proxy_buffers       32 64k;
    large_client_header_buffers 8 64k;

    # 统一转发头
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;

    # Realtime WebSocket 反代（确保全局唯一）
    location ^~ /canvas-realtime {
        # 兼容无尾斜杠请求
        rewrite ^/canvas-realtime$ /canvas-realtime/ break;

        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_pass http://127.0.0.1:6020/;
        proxy_read_timeout 300s;
    }

    # 其余规则（敏感文件/.well-known/redirect/ssl_ciphers 等）按原有配置
    include /www/sites/zmind.so/proxy/*.conf;
}

