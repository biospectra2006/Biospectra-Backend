/**
 * check_editorial.js
 * Quick sanity check: fetches editorial board data from running backend API at localhost:5000
 * and prints counts per member type.
 * Run: node scripts/check_editorial.js   (requires backend running)
 */

async function check() {
    try {
        const response = await fetch('http://localhost:5000/api/editorial');
        const data = await response.json();
        console.log('Total members:', data.length);
        const advisory = data.filter(m => m.memberType === 'national_advisory');
        console.log('National Advisory members:', advisory.length);
        if (advisory.length > 0) {
            console.log('Sample advisory member:', advisory[0]);
        }
    } catch (error) {
        console.error('Check failed:', error.message);
    }
}

check();
