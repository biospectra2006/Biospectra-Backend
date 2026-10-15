const Guideline = require('../models/Guideline');

const DEFAULT_GUIDELINES = [
    {
        title: 'Aims and Objectives',
        sectionType: 'aims',
        order: 1,
        content: `<p><strong>BIOSPECTRA: ISSN:0973-7057</strong> is an innovative, refereed, biannual (every March and September) multicolumn research journal in the field of Life Sciences published by the Madhawi-Shyam Educational Trust, Ranchi, Jharkhand, India (Reg. No. 20560/IV-1815/2005). It is dedicated to cover wide spectrum original research papers under following categories:</p>
<ul>
<li><strong>Review Articles:</strong> On any pre-published idea or topic with the latest information and with more than 50 references.</li>
<li><strong>Invited Articles:</strong> Covering conceptual write-up of 4-6 page materials on burning topics of Life science research without the standard format of a full-length research paper.</li>
<li><strong>Full-Length Papers:</strong> Covering standard write-up span of 6-8 Page maker pages (10-12 MS Word pages) double space typed material with tables and graphs/figs. Photographs up to 4-6, may also be accommodated in black and white strictly in the standard format given below.</li>
<li><strong>Popular Articles:</strong> On any burning issue of Life Science without constraints of standard format limitations.</li>
<li><strong>Research/Short Communications:</strong> Covering standard write-up span of 3-5 pages.</li>
<li><strong>Research News:</strong> Covering important national/international discoveries of common man interest, also information on conference, symposia and seminar.</li>
</ul>`
    },
    {
        title: 'Format for Full-Length Papers',
        sectionType: 'format',
        order: 2,
        content: `<ul>
<li>The materials should be typed in double space MS Word on one side only of A-4 size paper.</li>
<li>One of the names of the authors should be asterisked as the correspondent author to be given in the foot space with email-id / Mobile number.</li>
<li>A brief abstract and keywords (not more than 10) should precede the introduction.</li>
<li>The entire write-up should be arranged under the heads: Introduction, Materials & Methods, Results & Discussion, Tables, Graphs/Fig. & Photographs, Acknowledgment and References.</li>
<li>All references should be numbered according to the sequence of the text, arranged serially without alphabetical consideration and superscript in the text as and where mentioned.</li>
<li>The article should be submitted 45 days in advance, in one soft copy and two hard copies for mailing to the referees.</li>
</ul>`
    },
    {
        title: 'References Style Guide',
        sectionType: 'references',
        order: 3,
        content: `<p>References of Book and Journal should be written as follows:</p>
<h4>Books</h4>
<ol>
<li>Lee G. R., Foerster J., Lukenth J., Paraskevas F., Greer J. P. & Rodgers G.M. 1999. Winthrobes Clinical Hematology, Vol. 1, 10th edition.</li>
<li>Fange R. 1992. Fish blood cells, in Fish Physiology, edited by W. S. Hoar, D. J. Randall & A. P. Farrel.</li>
</ol>
<h4>Journals</h4>
<ol start="3">
<li>Exley C., Chappell J. S. & Brichall J. D. 1991. A mechanism of acute aluminium toxicity in fish, <em>J. theoretical Biol.</em> 15(1): 42-47</li>
</ol>
<p><em>In no case should the references cited in the text and in the reference column miss reciprocal placing.</em></p>`
    },
    {
        title: 'General Information',
        sectionType: 'general',
        order: 4,
        content: `<p>At least one of the authors (in a group of 3 co-authors only) must be a member of the journal under the trust, MSET. The membership can be procured by filling up the form as per any of the subscription options given thereon. All remittances should be in favour of Madhawi Shyam Educational Trust, Ranchi.</p>
<p><strong>Authors are requested not to plagiarize the pre-published materials in verbatim in order to help us in achieving the quality control of the journal. The editorial board is not responsible for any duplication or dispute in the write-up of the article.</strong></p>`
    }
];

// 1. Get all guidelines (auto-seeds defaults if empty)
exports.getGuidelines = async (req, res) => {
    try {
        let guidelines = await Guideline.find().sort({ order: 1 });
        if (guidelines.length === 0) {
            await Guideline.insertMany(DEFAULT_GUIDELINES);
            guidelines = await Guideline.find().sort({ order: 1 });
        }
        res.status(200).json(guidelines);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. Create a guideline section
exports.createGuideline = async (req, res) => {
    try {
        const { title, sectionType, content, order } = req.body;
        if (!title || !content) {
            return res.status(400).json({ message: 'Title and content are required' });
        }
        const guideline = await Guideline.create({
            title,
            sectionType: sectionType || 'general',
            content,
            order: order !== undefined ? order : 0
        });
        res.status(201).json(guideline);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. Update a guideline section
exports.updateGuideline = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, sectionType, content, order } = req.body;
        const updated = await Guideline.findByIdAndUpdate(
            id,
            { title, sectionType, content, order },
            { new: true, runValidators: true }
        );
        if (!updated) {
            return res.status(404).json({ message: 'Guideline section not found' });
        }
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. Delete a guideline section
exports.deleteGuideline = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Guideline.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ message: 'Guideline section not found' });
        }
        res.status(200).json({ message: 'Guideline section deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
