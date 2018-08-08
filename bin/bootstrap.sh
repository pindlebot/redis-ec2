#!/usr/bin/env bash

cd /usr/local/src
wget https://s3.amazonaws.com/aws-lambda-binaries/redis-5.0-rc4.tar.gz
tar xzf redis-5.0-rc4.tar.gz
cd redis-5.0-rc4
mkdir -p /etc/redis /var/lib/redis /var/redis/6379
cp src/redis-server src/redis-cli /usr/local/bin
cp redis.conf /etc/redis/6379.conf
wget https://raw.githubusercontent.com/saxenap/install-redis-amazon-linux-centos/master/redis-server
mv redis-server /etc/init.d
chmod 755 /etc/init.d/redis-server
chkconfig --add redis-server
chkconfig --level 345 redis-server on
sed -i 's/protected-mode yes/protected-mode no/' /etc/redis/6379.conf
sed -i 's/bind\s127.0.0.1/bind 0.0.0.0/' /etc/redis/6379.conf
sed -i 's/daemonize no/daemonize yes/' /etc/redis/6379.conf
sed -i 's#logfile ""#logfile "/var/log/redis_6379.log"#' /etc/redis/6379.conf
sed -i 's#dir ./#dir /var/redis/6379#' /etc/redis/6379.conf
sed -i 's#REDIS_CONF_FILE="/etc/redis/redis.conf"#REDIS_CONF_FILE="/etc/redis/6379.conf"#' /etc/init.d/redis-server
service iptables save
service iptables stop
chkconfig iptables off
