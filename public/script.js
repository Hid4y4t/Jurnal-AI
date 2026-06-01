const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const alertContainer = document.getElementById('alertContainer');

// Show alert function
function showAlert(message, type = 'danger') {
    alertContainer.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            <i class="fas fa-${type === 'danger' ? 'exclamation-circle' : 'info-circle'} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    setTimeout(() => {
        const alert = alertContainer.firstChild;
        if (alert) alert.classList.remove('show');
        setTimeout(() => {
            alertContainer.innerHTML = '';
        }, 300);
    }, 5000);
}

// Drag & drop
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/plain' || file.type === 'application/pdf')) {
        handleFileUpload(file);
    } else {
        showAlert('Hanya file TXT dan PDF yang diperbolehkan!', 'danger');
    }
});

uploadArea.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        handleFileUpload(file);
    }
});

async function handleFileUpload(file) {
    // Validasi ukuran file (10MB)
    if (file.size > 10 * 1024 * 1024) {
        showAlert('Ukuran file terlalu besar! Maksimal 10MB.', 'danger');
        return;
    }
    
    const formData = new FormData();
    formData.append('journal', file);
    
    // Tampilkan info file
    fileName.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    fileInfo.classList.remove('d-none');
    document.getElementById('uploadSpinner').classList.remove('d-none');
    
    // Hide upload area
    uploadArea.style.opacity = '0.5';
    uploadArea.style.pointerEvents = 'none';
    
    // Tampilkan loading
    loading.classList.remove('d-none');
    results.classList.add('d-none');
    showAlert(`Sedang membaca ${file.name}... AI akan memproses dalam beberapa saat`, 'info');
    
    try {
        const response = await fetch('/analyze', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Gagal menganalisis jurnal');
        }
        
        const data = await response.json();
        
        // Cek jika ada error dari response
        if (data.error) {
            throw new Error(data.error);
        }
        
        displayResults(data);
        showAlert('Analisis berhasil! Silakan lihat hasil di bawah.', 'success');
        
    } catch (error) {
        console.error('Error:', error);
        showAlert('Terjadi kesalahan: ' + error.message, 'danger');
    } finally {
        loading.classList.add('d-none');
        uploadArea.style.opacity = '1';
        uploadArea.style.pointerEvents = 'auto';
        fileInfo.classList.add('d-none');
        document.getElementById('uploadSpinner').classList.add('d-none');
        fileInput.value = '';
    }
}

function displayResults(data) {
    // Tampilkan summary
    if (data.summary) {
        const summaryContainer = document.querySelector('#summary p');
        summaryContainer.innerHTML = `<i class="fas fa-quote-left text-muted me-2"></i>${data.summary}`;
    }
    
    // Tampilkan poin penting
    const keyPointsContainer = document.querySelector('#keyPoints .list-group');
    keyPointsContainer.innerHTML = '';
    if (data.keyPoints && data.keyPoints.length > 0) {
        data.keyPoints.forEach(point => {
            keyPointsContainer.innerHTML += `
                <div class="list-group-item">
                    <i class="fas fa-check-circle text-success me-2"></i>
                    ${point}
                </div>
            `;
        });
    } else {
        keyPointsContainer.innerHTML = '<div class="list-group-item text-muted">Tidak ada data poin penting</div>';
    }
    
    // Tampilkan kelemahan
    const weaknessesContainer = document.querySelector('#weaknesses .list-group');
    weaknessesContainer.innerHTML = '';
    if (data.weaknesses && data.weaknesses.length > 0) {
        data.weaknesses.forEach(weakness => {
            weaknessesContainer.innerHTML += `
                <div class="list-group-item">
                    <i class="fas fa-times-circle text-danger me-2"></i>
                    ${weakness}
                </div>
            `;
        });
    } else {
        weaknessesContainer.innerHTML = '<div class="list-group-item text-muted">Tidak ada data kelemahan</div>';
    }
    
    // Tampilkan penelitian baru
    document.getElementById('researchTitle').innerHTML = `<i class="fas fa-quote-left me-2"></i>${data.newResearchTitle || 'Tidak tersedia'}`;
    document.getElementById('researchRationale').innerHTML = data.researchRationale || 'Tidak tersedia';
    
    // Tampilkan results
    results.classList.remove('d-none');
    
    // Scroll ke results dengan smooth
    setTimeout(() => {
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}