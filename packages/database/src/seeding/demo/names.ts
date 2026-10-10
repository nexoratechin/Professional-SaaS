/**
 * Name, place and organisation pools used by the demo seeder. Data only — using fixed pools
 * keeps every generated person/company consistent across repeat runs.
 */

export const STUDENT_FIRST_NAMES = [
  'Aarav', 'Ananya', 'Vivaan', 'Diya', 'Aditya', 'Ishita', 'Arjun', 'Saanvi', 'Reyansh', 'Aadhya',
  'Krishna', 'Myra', 'Ishaan', 'Anika', 'Rohan', 'Navya', 'Kabir', 'Kiara', 'Ayaan', 'Pari',
  'Dhruv', 'Riya', 'Advait', 'Tanvi', 'Yash', 'Nisha', 'Om', 'Mira', 'Neel', 'Aisha',
  'Rudra', 'Sara', 'Veer', 'Aarohi', 'Shaurya', 'Mahi', 'Aryan', 'Zara', 'Dev', 'Prisha',
] as const;

export const STUDENT_LAST_NAMES = [
  'Sharma', 'Patel', 'Iyer', 'Deshmukh', 'Kulkarni', 'Reddy', 'Nair', 'Joshi', 'Mehta', 'Bose',
  'Chauhan', 'Rao', 'Gupta', 'Menon', 'Verma', 'Naidu', 'Pillai', 'Agarwal', 'Shetty', 'Bhat',
] as const;

export const FACULTY_FIRST_NAMES = [
  'Dr. Rajesh', 'Prof. Meenakshi', 'Dr. Suresh', 'Dr. Priya', 'Prof. Anand', 'Dr. Kavita',
  'Dr. Vikram', 'Prof. Sunita', 'Dr. Arun', 'Dr. Lakshmi', 'Prof. Girish', 'Dr. Radha',
  'Dr. Mohan', 'Prof. Sarita', 'Dr. Karthik', 'Dr. Nandini',
] as const;

export const STAFF_NAMES = [
  'Rajendra Pawar', 'Sneha Kulkarni', 'Mohan Bhandari', 'Rekha Chavan', 'Ajay Phadke',
  'Vandana Kirtikar', 'Nitin Gokhale', 'Pallavi Sawant', 'Dinesh Kadam', 'Asha Bhatt',
] as const;

export const GUARDIAN_FIRST_NAMES = [
  'Ramesh', 'Sunita', 'Mahesh', 'Kavita', 'Dinesh', 'Anita', 'Prakash', 'Geeta', 'Ashok', 'Shobha',
  'Vinod', 'Meena', 'Suresh', 'Seema', 'Ravi', 'Nirmala', 'Manoj', 'Usha', 'Deepak', 'Smita',
] as const;

export const GUARDIAN_OCCUPATIONS = [
  'Business Owner', 'Civil Engineer', 'Government Officer', 'Doctor', 'Teacher',
  'Bank Manager', 'Farmer', 'Software Engineer', 'Shopkeeper', 'Chartered Accountant',
] as const;

export const STREETS = [
  'Shivaji Nagar', 'Kothrud', 'Aundh', 'Baner', 'Hadapsar', 'Wakad', 'Viman Nagar', 'Karve Nagar',
] as const;

export const ADMISSION_ENQUIRY_NAMES = [
  'Pooja Khandelwal', 'Sahil Gaba', 'Ritika Shah', 'Nikhil Menon', 'Aditi Bhosale', 'Manav Rathi',
] as const;

export const PLACEMENT_COMPANIES = [
  {
    code: 'NEXORA',
    name: 'Nexora Technologies Pvt. Ltd.',
    companyType: 'STARTUP',
    industry: 'Software Product',
    city: 'Bengaluru',
    website: 'https://nexora.example.com',
  },
  {
    code: 'BLUEORBIT',
    name: 'BlueOrbit Analytics',
    companyType: 'MNC',
    industry: 'Data Analytics',
    city: 'Pune',
    website: 'https://blueorbit.example.com',
  },
  {
    code: 'ZENITH',
    name: 'Zenith Consulting LLP',
    companyType: 'CORPORATE',
    industry: 'Management Consulting',
    city: 'Mumbai',
    website: 'https://zenith-consulting.example.com',
  },
  {
    code: 'COGNIVUE',
    name: 'Cognivue Systems India',
    companyType: 'INDIAN_MNC',
    industry: 'Enterprise Software',
    city: 'Hyderabad',
    website: 'https://cognivue.example.com',
  },
] as const;

export const INVENTORY_VENDORS = [
  { code: 'VEN-STAT', name: 'Stationery Mart Pvt. Ltd.', city: 'Pune', gstin: '27AAACS1234F1Z5', contactPerson: 'Suresh Jain' },
  { code: 'VEN-LAB', name: 'Precision Lab Supplies', city: 'Mumbai', gstin: '27AABCP5678G1Z2', contactPerson: 'Nandini Rao' },
  { code: 'VEN-TECH', name: 'DigiCore Electronics', city: 'Pune', gstin: '27AACCD9012H1Z8', contactPerson: 'Imran Sheikh' },
  { code: 'VEN-FURN', name: 'Ergo Furniture House', city: 'Nagpur', gstin: '27AAFCE3456J1Z1', contactPerson: 'Vasudha Kale' },
] as const;

export const LIBRARY_AUTHORS = [
  ['Thomas H.', 'Cormen'], ['Robert', 'Sedgewick'], ['Abraham', 'Silberschatz'], ['Andrew S.', 'Tanenbaum'],
  ['Randal E.', 'Bryant'], ['Robert C.', 'Martin'], ['Philip', 'Kotler'], ['Stephen A.', 'Ross'],
  ['M. Morris', 'Mano'], ['Charles T.', 'Horngren'],
] as const;

export const LIBRARY_PUBLISHERS = [
  { code: 'PUB-PHI', name: 'PHI Learning', city: 'New Delhi' },
  { code: 'PUB-PEA', name: 'Pearson Education', city: 'Noida' },
  { code: 'PUB-WIL', name: 'Wiley India', city: 'New Delhi' },
  { code: 'PUB-MCG', name: 'McGraw Hill Education', city: 'Chennai' },
] as const;
