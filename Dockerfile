# syntax=docker/dockerfile:1 
                                                                                                                                                                                                    
FROM node:lts-bookworm AS builder                                                                                       
WORKDIR /src                                                                                                            
COPY package*.json ./                                                                                                   
RUN npm install                                                                                                         
COPY . .                                                                                                               
RUN npm run build                                                                                                       
                                                                                                                    
FROM node:lts-bookworm                                                                                                  
WORKDIR /app                                                                                                            
COPY package*.json ./                                                                                                   
                                                                                                                    
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y libnss3 \                                       
    libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \                       
    libgbm1 libxkbcommon0 libasound2 libcups2 xvfb                                                                      
                                                                                                                    
ARG SUNO_COOKIE             
RUN if [ -z "$SUNO_COOKIE" ]; then echo "Warning: SUNO_COOKIE is not set. You will have to set the cookies in the Cookie header of your requests."; fi                                           
ENV SUNO_COOKIE=${SUNO_COOKIE}
# Disable GPU acceleration, as with it suno-api won't work in a Docker environment
ENV BROWSER_DISABLE_GPU=true

RUN npm install --only=production                                                                                       
                                                                                                                    
# Install all supported browsers, else switching browsers requires an image rebuild                                     
RUN npx playwright install chromium                                                                                     
# RUN npx playwright install firefox                                                                                     
                                                                                                                    
COPY --from=builder /src/.next ./.next
COPY --from=builder /src/public/github-mark.png ./public/github-mark.png
COPY --from=builder /src/public/github-logo.webp ./public/github-logo.webp
COPY --from=builder /src/public/drag-instructions.jpg ./public/drag-instructions.jpg
COPY --from=builder /src/public/get-cookie-demo.gif ./public/get-cookie-demo.gif
COPY --from=builder /src/public/get-cookie-demo.mp4 ./public/get-cookie-demo.mp4
COPY --from=builder /src/public/suno-banner.png ./public/suno-banner.png
COPY --from=builder /src/public/vercel.svg ./public/vercel.svg
COPY --from=builder /src/public/next.svg ./public/next.svg
COPY --from=builder /src/public/swagger-suno-api.json ./public/swagger-suno-api.json
COPY --from=builder /src/next.config.mjs ./next.config.mjs
EXPOSE 3000                                                                                                             
CMD ["npm", "run", "start"]