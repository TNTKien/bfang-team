// Custom Video Player
let activeVideoPlayer = null;

function getPointerClientX(event) {
    if (typeof event.clientX === 'number') {
        return event.clientX;
    }

    if (event.touches && event.touches.length > 0) {
        return event.touches[0].clientX;
    }

    if (event.changedTouches && event.changedTouches.length > 0) {
        return event.changedTouches[0].clientX;
    }

    return null;
}

function isTypingTarget(element) {
    if (!element) {
        return false;
    }

    const tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
}

function isLikelyTouchDevice() {
    if (typeof window === 'undefined') {
        return false;
    }

    const coarsePointer = typeof window.matchMedia === 'function' && (
        window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(hover: none)').matches
    );
    const touchPoints = typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints || 0) > 0;
    return coarsePointer || touchPoints || ('ontouchstart' in window);
}

class CustomVideoPlayer {
    constructor(container) {
        this.container = container;
        this.video = container.querySelector('video');
        this.playBtn = container.querySelector('.video-play-btn');
        this.playOverlay = container.querySelector('.video-play-overlay');
        this.poster = container.querySelector('.video-poster');
        this.progressContainer = container.querySelector('.video-progress-container');
        this.progress = container.querySelector('.video-progress');
        this.timeDisplay = container.querySelector('.video-time');
        this.volumeBtn = container.querySelector('.video-volume-btn');
        this.volumeSlider = container.querySelector('.video-volume-slider');
        this.volumeLevel = container.querySelector('.video-volume-level');
        this.fullscreenBtn = container.querySelector('.video-fullscreen-btn');
        this.loading = container.querySelector('.video-loading');
        this.errorMessage = container.querySelector('.video-error-message');
        
        // Control visibility
        this.controlsTimeout = null;
        this.isDraggingVolume = false;
        this.isDraggingProgress = false;
        this.dragSeekPercent = null;
        this.isTouchDevice = isLikelyTouchDevice();
        this.isReady = Boolean(
            this.video &&
            this.playBtn &&
            this.playOverlay &&
            this.progressContainer &&
            this.progress &&
            this.timeDisplay
        );

        if (!this.isReady) {
            return;
        }

        if (this.isTouchDevice) {
            this.container.classList.add('touch-device');
        }
        
        this.init();
    }

    setActive() {
        activeVideoPlayer = this;
    }
    
    init() {
        if (!this.isReady) {
            return;
        }

        if (!this.isTouchDevice) {
            this.container.addEventListener('mouseenter', () => this.setActive());
        }
        this.container.addEventListener('touchstart', () => this.setActive(), { passive: true });
        this.container.addEventListener('click', () => this.setActive());

        // Load poster from image or generate from video
        if (!this.poster && this.video) {
            this.video.addEventListener('loadeddata', () => {
                if (!this.poster) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = this.video.videoWidth;
                        canvas.height = this.video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

                        const posterImg = document.createElement('img');
                        posterImg.src = canvas.toDataURL('image/jpeg', 0.8);
                        posterImg.className = 'video-poster';
                        posterImg.alt = 'Video thumbnail';
                        this.container.insertBefore(posterImg, this.video);
                        this.poster = posterImg;
                    } catch (error) {
                        console.warn('Cannot generate poster image:', error);
                    }
                }
            }, { once: true });
        }
        
        // Auto-hide controls
        this.setupAutoHideControls();
        
        // Play/Pause
        this.playBtn.addEventListener('click', () => this.togglePlay());
        this.playOverlay.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePlay();
        });
        this.playOverlay.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePlay();
        }, { passive: false });
        this.video.addEventListener('click', () => this.togglePlay());
        this.video.addEventListener('play', () => {
            this.applyPlayingState();
            this.clearError();
            this.setActive();
        });
        this.video.addEventListener('playing', () => {
            this.applyPlayingState();
            this.clearError();
        });
        this.video.addEventListener('pause', () => {
            this.applyPausedState();
        });
        
        // Progress
        this.video.addEventListener('timeupdate', () => {
            this.updateProgress();
            if (!this.video.paused && !this.video.ended) {
                this.applyPlayingState();
            }
        });
        this.progressContainer.addEventListener('mousedown', (e) => this.startProgressDrag(e));
        this.progressContainer.addEventListener('touchstart', (e) => this.startProgressDrag(e), { passive: false });

        document.addEventListener('mousemove', (e) => this.handleProgressDrag(e));
        document.addEventListener('mouseup', () => this.stopProgressDrag());
        document.addEventListener('touchmove', (e) => this.handleProgressDrag(e), { passive: false });
        document.addEventListener('touchend', () => this.stopProgressDrag());
        document.addEventListener('touchcancel', () => this.stopProgressDrag());
        
        // Volume
        if (this.volumeBtn) {
            this.volumeBtn.addEventListener('click', () => this.toggleMute());
            
            // Click to set volume
            this.volumeSlider.addEventListener('click', (e) => this.setVolume(e));
            this.volumeSlider.addEventListener('touchstart', (e) => this.setVolume(e), { passive: true });
            
            // Drag to set volume
            this.volumeSlider.addEventListener('mousedown', (e) => {
                this.setActive();
                this.isDraggingVolume = true;
                this.container.classList.add('dragging-volume');
                this.setVolume(e);
            });
            
            document.addEventListener('mousemove', (e) => {
                if (this.isDraggingVolume) {
                    this.setVolume(e);
                }
            });
            
            document.addEventListener('mouseup', () => {
                if (this.isDraggingVolume) {
                    this.isDraggingVolume = false;
                    this.container.classList.remove('dragging-volume');
                }
            });
        }
        
        // Fullscreen
        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
            document.addEventListener('fullscreenchange', () => this.syncFullscreenIcon());
            document.addEventListener('webkitfullscreenchange', () => this.syncFullscreenIcon());
            document.addEventListener('msfullscreenchange', () => this.syncFullscreenIcon());
        }
        
        // Time display
        this.video.addEventListener('loadedmetadata', () => this.updateTimeDisplay());
        this.video.addEventListener('timeupdate', () => this.updateTimeDisplay());
        
        // Loading
        this.video.addEventListener('waiting', () => {
            if (this.loading) {
                this.loading.classList.add('active');
            }
        });
        this.video.addEventListener('canplay', () => {
            if (this.loading) {
                this.loading.classList.remove('active');
            }
            this.clearError();
        });
        this.video.addEventListener('loadstart', () => this.clearError());
        this.video.addEventListener('error', () => this.handleVideoError());
        
        // Ended
        this.video.addEventListener('ended', () => {
            this.applyPausedState();
        });

        this.updateProgress();
        this.updateTimeDisplay();
    }
    
    togglePlay() {
        this.setActive();

        if (this.video.paused) {
            this.applyPlayingState();
            const playPromise = this.video.play();
            const applyPlayingState = () => {
                this.applyPlayingState();
                this.clearError();
            };

            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise
                    .then(() => {
                        applyPlayingState();
                    })
                    .catch((error) => {
                        if (error && error.name === 'AbortError') {
                            return;
                        }

                        if (this.video.error || (error && (error.name === 'NotSupportedError' || error.name === 'SecurityError'))) {
                            this.handleVideoError();
                            return;
                        }

                        this.applyPausedState();
                        console.warn('Video play() rejected:', error);
                    });
            } else {
                applyPlayingState();
            }
        } else {
            this.video.pause();
        }
    }

    applyPlayingState() {
        if (!this.isReady) {
            return;
        }

        this.playBtn.innerHTML = '<i class="fas fa-pause"></i>';
        this.playOverlay.classList.add('hidden');
        this.container.classList.add('playing');

        if (this.poster) {
            this.poster.classList.add('hidden');
        }
    }

    applyPausedState() {
        if (!this.isReady) {
            return;
        }

        this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
        this.playOverlay.classList.remove('hidden');
        this.container.classList.remove('playing');
    }
    
    updateProgress() {
        if (!this.progress) {
            return;
        }

        if (this.isDraggingProgress && this.dragSeekPercent !== null) {
            this.renderProgressFromPercent(this.dragSeekPercent);
            return;
        }

        if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) {
            this.progress.style.width = '0%';
            return;
        }

        const percent = (this.video.currentTime / this.video.duration) * 100;
        this.progress.style.width = percent + '%';
    }
    
    seek(e) {
        this.setActive();

        const percent = this.getProgressPercentFromEvent(e);
        if (percent === null) {
            return;
        }

        this.dragSeekPercent = percent;
        this.renderProgressFromPercent(percent);

        if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) {
            return;
        }

        this.video.currentTime = percent * this.video.duration;
    }

    getProgressPercentFromEvent(e) {
        const clientX = getPointerClientX(e);
        if (clientX === null) {
            return null;
        }

        const rect = this.progressContainer.getBoundingClientRect();
        if (rect.width <= 0) {
            return null;
        }

        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    renderProgressFromPercent(percent) {
        if (!this.progress) {
            return;
        }

        const safePercent = Math.max(0, Math.min(1, percent));
        this.progress.style.width = `${safePercent * 100}%`;

        if (this.timeDisplay && Number.isFinite(this.video.duration) && this.video.duration > 0) {
            const previewTime = safePercent * this.video.duration;
            this.timeDisplay.textContent = `${this.formatTime(previewTime)} / ${this.formatTime(this.video.duration)}`;
        }
    }

    startProgressDrag(e) {
        this.setActive();
        this.isDraggingProgress = true;
        this.container.classList.add('dragging-progress');

        if (e.cancelable) {
            e.preventDefault();
        }

        const percent = this.getProgressPercentFromEvent(e);
        if (percent !== null) {
            this.dragSeekPercent = percent;
            this.renderProgressFromPercent(percent);
        }
    }

    handleProgressDrag(e) {
        if (!this.isDraggingProgress) {
            return;
        }

        if (e.cancelable) {
            e.preventDefault();
        }

        const percent = this.getProgressPercentFromEvent(e);
        if (percent !== null) {
            this.dragSeekPercent = percent;
            this.renderProgressFromPercent(percent);
        }
    }

    stopProgressDrag() {
        if (!this.isDraggingProgress) {
            return;
        }

        if (this.dragSeekPercent !== null && Number.isFinite(this.video.duration) && this.video.duration > 0) {
            this.video.currentTime = this.dragSeekPercent * this.video.duration;
        }

        this.isDraggingProgress = false;
        this.container.classList.remove('dragging-progress');
        this.dragSeekPercent = null;

        this.updateProgress();
        this.updateTimeDisplay();
    }
    
    toggleMute() {
        this.setActive();
        this.video.muted = !this.video.muted;
        this.updateVolumeIcon();

        if (this.volumeLevel) {
            this.volumeLevel.style.width = this.video.muted ? '0%' : (this.video.volume * 100) + '%';
        }
    }
    
    setVolume(e) {
        if (!this.volumeSlider) return;

        this.setActive();

        const clientX = getPointerClientX(e);
        if (clientX === null) {
            return;
        }
        
        const rect = this.volumeSlider.getBoundingClientRect();
        let percent = (clientX - rect.left) / rect.width;
        
        // Clamp between 0 and 1
        percent = Math.max(0, Math.min(1, percent));
        
        this.video.volume = percent;
        this.video.muted = false;

        if (this.volumeLevel) {
            this.volumeLevel.style.width = (percent * 100) + '%';
        }

        this.updateVolumeIcon();
    }
    
    updateVolumeIcon() {
        if (!this.volumeBtn) return;
        
        if (this.video.muted || this.video.volume === 0) {
            this.volumeBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        } else if (this.video.volume < 0.5) {
            this.volumeBtn.innerHTML = '<i class="fas fa-volume-down"></i>';
        } else {
            this.volumeBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        }
    }
    
    toggleFullscreen() {
        this.setActive();

        if (!this.isContainerFullscreen()) {
            if (this.container.requestFullscreen) {
                this.container.requestFullscreen();
            } else if (this.container.webkitRequestFullscreen) {
                this.container.webkitRequestFullscreen();
            } else if (this.container.msRequestFullscreen) {
                this.container.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }

        setTimeout(() => this.syncFullscreenIcon(), 0);
    }

    isContainerFullscreen() {
        return document.fullscreenElement === this.container ||
            document.webkitFullscreenElement === this.container ||
            document.msFullscreenElement === this.container;
    }

    syncFullscreenIcon() {
        if (!this.fullscreenBtn) {
            return;
        }

        if (this.isContainerFullscreen()) {
            this.fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            this.fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
        }
    }
    
    updateTimeDisplay() {
        if (!this.timeDisplay) {
            return;
        }

        const current = this.formatTime(this.video.currentTime);
        const duration = this.formatTime(this.video.duration);
        this.timeDisplay.textContent = `${current} / ${duration}`;
    }
    
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    setupAutoHideControls() {
        if (!this.isTouchDevice) {
            // Show controls on mouse move
            this.container.addEventListener('mousemove', () => {
                this.showControls();
                this.resetControlsTimeout();
            });

            // Show controls on mouse enter
            this.container.addEventListener('mouseenter', () => {
                this.showControls();
            });

            // Keep controls visible when hovering over them
            this.container.addEventListener('mouseleave', () => {
                if (!this.video.paused) {
                    this.hideControls();
                }
            });
        }

        this.container.addEventListener('touchstart', () => {
            this.isTouchDevice = true;
            this.container.classList.add('touch-device');
            this.showControls();
            this.resetControlsTimeout();
        }, { passive: true });
        
        // Hide controls when playing
        this.video.addEventListener('play', () => {
            this.resetControlsTimeout();
        });
        
        // Show controls when paused
        this.video.addEventListener('pause', () => {
            this.showControls();
            this.clearControlsTimeout();
        });
    }
    
    showControls() {
        this.container.classList.add('show-controls');
    }
    
    hideControls() {
        if (!this.video.paused && !this.isDraggingProgress && !this.isDraggingVolume) {
            this.container.classList.remove('show-controls');
        }
    }
    
    resetControlsTimeout() {
        this.clearControlsTimeout();
        if (!this.video.paused) {
            this.controlsTimeout = setTimeout(() => {
                this.hideControls();
            }, 3000); // Hide after 3 seconds of inactivity
        }
    }
    
    clearControlsTimeout() {
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
            this.controlsTimeout = null;
        }
    }
    
    handleKeyboard(e) {
        // Only handle if video is visible
        const rect = this.video.getBoundingClientRect();
        if (rect.top > window.innerHeight || rect.bottom < 0) return;
        
        switch(e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                this.togglePlay();
                break;
            case 'f':
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case 'm':
                e.preventDefault();
                this.toggleMute();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.video.currentTime = Math.max(0, this.video.currentTime - 5);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (Number.isFinite(this.video.duration)) {
                    this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 5);
                } else {
                    this.video.currentTime += 5;
                }
                break;
        }
    }

    handleVideoError() {
        if (this.loading) {
            this.loading.classList.remove('active');
        }

        this.container.classList.remove('playing');
        this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
        this.playOverlay.classList.remove('hidden');

        if (this.poster) {
            this.poster.classList.remove('hidden');
        }

        this.showError('Không tải được video. Thử tải lại trang hoặc mở link gốc.');
    }

    showError(message) {
        if (!this.errorMessage) {
            return;
        }

        const textNode = this.errorMessage.querySelector('.video-error-text');
        const sourceNode = this.video ? this.video.querySelector('source') : null;
        const linkNode = this.errorMessage.querySelector('.video-error-link');

        if (textNode) {
            textNode.textContent = message;
        }

        if (linkNode && sourceNode && sourceNode.src) {
            linkNode.href = sourceNode.src;
        }

        this.errorMessage.classList.add('active');
    }

    clearError() {
        if (this.errorMessage) {
            this.errorMessage.classList.remove('active');
        }
    }
}

// Initialize all video players
document.addEventListener('DOMContentLoaded', function() {
    const videoContainers = document.querySelectorAll('.custom-video-player');
    videoContainers.forEach(container => {
        new CustomVideoPlayer(container);
    });

    document.addEventListener('keydown', (e) => {
        if (!activeVideoPlayer || isTypingTarget(document.activeElement)) {
            return;
        }

        activeVideoPlayer.handleKeyboard(e);
    });
});
